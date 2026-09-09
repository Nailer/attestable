// Phase 3.3-3.5 — the proof worker.
//
// The worker is a PROOF COURIER, not a decision maker. It watches the source
// chain, waits for Attestcoin's attestation frontier, builds proofs, and submits
// them. It never decides whether evidence is valid, never computes settlement,
// never approves anything, and is never a source of truth. Every decision lives
// in the Creditcoin contracts, which independently verify whatever it delivers.
//
// A hostile worker can therefore only waste its own gas. It cannot fabricate
// evidence (the proof would fail verification), and it cannot suppress evidence
// (submission is permissionless — anyone else can submit).
import 'dotenv/config';
import { ethers } from 'ethers';
import { proofProvider, chainInfo } from '@gluwa/usc-sdk';
import { readFileSync } from 'fs';
import { ANSWER_UPDATED } from './scenarios';

const COVER_ABI = JSON.parse(readFileSync('contracts/abi/AttestableCover.json', 'utf8'));
const ASC_ABI = JSON.parse(readFileSync('contracts/abi/AttestableASC.json', 'utf8'));

export interface WorkerDeps {
  cc: ethers.JsonRpcProvider;
  source: ethers.JsonRpcProvider;
  wallet: ethers.Wallet;
}

function gasFor(rootCount: number): bigint {
  // Reference formula: 21k base + ~5k per continuity root + ~20k overhead.
  // Tripled for headroom — the ASC also decodes a 3kB receipt and calls into
  // the Cover contract, well beyond what the reference minter did.
  return BigInt((21000 + rootCount * 5000 + 20000) * 3);
}

/** Wait until Attestcoin can prove this height, then build the proof. */
async function proofFor(
  builder: proofProvider.service.ProofBuilder,
  txHash: string,
  chainKey: number,
  block: number
) {
  await builder.waitUntilHeightAttested(chainKey, block, 15_000, 1_200_000);
  const r = await builder.getProof(txHash);
  if (!r.success || !r.data) throw new Error(`proof failed for ${txHash}: ${(r as any).error}`);
  return r.data;
}

/**
 * Fill a cover with every qualifying update inside its window.
 *
 * Evidence is submitted in CHRONOLOGICAL ORDER because the Cover contract
 * evaluates max-interval incrementally and rejects anything out of sequence.
 */
export async function fillCover(deps: WorkerDeps, coverId: number, opts: { dryRun?: boolean } = {}) {
  const { cc, source, wallet } = deps;
  const cover = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, COVER_ABI, wallet);
  const asc = new ethers.Contract(process.env.ATTESTABLE_ASC_ADDRESS!, ASC_ABI, wallet);
  const info = new chainInfo.PrecompileChainInfoProvider(cc);

  const policy = await cover.getPolicy(coverId);
  const chainKey = Number(policy.chainKey);
  const aggregator: string = policy.sourceContract;
  const windowStart = Number(policy.windowStart);
  const windowEnd = Number(policy.windowEnd);

  console.log(`\n=== filling cover #${coverId} ===`);
  console.log(`  source     : ${aggregator} on chainKey ${chainKey}`);
  console.log(`  window     : ${windowStart} .. ${windowEnd}`);
  console.log(`               ${new Date(windowStart * 1000).toISOString()} .. ${new Date(windowEnd * 1000).toISOString()}`);
  console.log(`  tolerance  : ${policy.toleranceSecs}s (${Number(policy.toleranceSecs) / 60} min)`);

  // Locate every qualifying event inside the window. Block range is derived
  // from the window's own end block, walking back generously.
  const endBlock = Number(policy.windowEndBlock);
  const fromBlock = endBlock - 6000;
  const logs = await source.getLogs({
    address: aggregator,
    topics: [ANSWER_UPDATED],
    fromBlock,
    toBlock: endBlock,
  });

  const inWindow: { tx: string; block: number; updatedAt: number }[] = [];
  for (const l of logs) {
    const updatedAt = Number(BigInt(l.data));
    if (updatedAt >= windowStart && updatedAt <= windowEnd) {
      inWindow.push({ tx: l.transactionHash, block: l.blockNumber, updatedAt });
    }
  }
  inWindow.sort((a, b) => a.updatedAt - b.updatedAt);

  console.log(`  found ${inWindow.length} qualifying update(s) inside the window`);
  for (const e of inWindow) {
    console.log(`    block ${e.block}  ts ${e.updatedAt}  ${new Date(e.updatedAt * 1000).toISOString()}`);
  }

  if (opts.dryRun) return { submitted: 0, found: inWindow.length };

  const attested = await info.getLatestAttestedHeightAndHash(chainKey);
  console.log(`  attestation frontier: ${attested.height}`);

  const builder = new proofProvider.service.ProofBuilder(chainKey, process.env.PROOF_BUILDER_URL!);
  let submitted = 0;

  for (const e of inWindow) {
    console.log(`\n  -> proving block ${e.block} (ts ${e.updatedAt})`);
    const p = await proofFor(builder, e.tx, chainKey, e.block);
    console.log(`     proof: ${p.merkleProof.siblings.length} siblings, ${p.continuityProof.roots.length} continuity roots`);

    const proofArg = {
      chainKey: p.chainKey,
      blockHeight: p.headerNumber,
      encodedTransaction: p.txBytes,
      merkleRoot: p.merkleProof.root,
      siblings: p.merkleProof.siblings,
      lowerEndpointDigest: p.continuityProof.lowerEndpointDigest,
      continuityRoots: p.continuityProof.roots,
    };

    try {
      const tx = await asc.submitEvidence(coverId, proofArg, {
        gasLimit: gasFor(p.continuityProof.roots.length),
      });
      const rc = await tx.wait();
      console.log(`     submitted: ${tx.hash} (gas ${rc.gasUsed})`);
      submitted++;
    } catch (err: any) {
      console.error(`     REJECTED: ${err.shortMessage ?? err.message}`);
    }
  }

  const c = await cover.getCover(coverId);
  console.log(`\n  evidenceCount : ${c.evidenceCount}`);
  console.log(`  maxGap so far : ${c.maxGap}s (${(Number(c.maxGap) / 60).toFixed(1)} min)`);
  console.log(`  projected     : ${await cover.projectedMaxGap(coverId)}s`);
  return { submitted, found: inWindow.length };
}

if (require.main === module) {
  const coverId = Number(process.argv[2]);
  if (!coverId) {
    console.error('usage: tsx worker/relayer.ts <coverId> [--dry-run]');
    process.exit(1);
  }
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const source = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_RPC_URL!);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, cc);

  fillCover({ cc, source, wallet }, coverId, { dryRun: process.argv.includes('--dry-run') })
    .then(() => process.exit(0))
    .catch((e) => {
      console.error('FAILED:', e.message ?? e);
      process.exit(1);
    });
}
