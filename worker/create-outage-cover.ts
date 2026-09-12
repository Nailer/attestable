// Creates the CLAIMED demo cover over the genuine 2026-08-31 outage, and fills
// it with the two real updates that bound the 12.9-hour silence.
//
// Those blocks are beyond what public endpoints retain, so evidence is fetched
// through the archive endpoint using their exact known heights.
import 'dotenv/config';
import { ethers } from 'ethers';
import { proofProvider } from '@gluwa/usc-sdk';
import { readFileSync } from 'fs';
import { archiveProvider, getLogsAtBlocks } from './rpc';
import { ANSWER_UPDATED, TOLERANCE_SECS } from './scenarios';

const COVER_ABI = JSON.parse(readFileSync('contracts/abi/AttestableCover.json', 'utf8'));
const ASC_ABI = JSON.parse(readFileSync('contracts/abi/AttestableASC.json', 'utf8'));

const START_BLOCK = 11_602_342; // last update before the silence
const END_BLOCK = 11_605_987;   // first update after it
const COLLATERAL = ethers.parseEther('200');
const PREMIUM = ethers.parseEther('12');

async function main() {
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const src = archiveProvider();
  const underwriter = new ethers.Wallet(process.env.UNDERWRITER_PRIVATE_KEY!, cc);
  const buyer = new ethers.Wallet(process.env.BUYER_PRIVATE_KEY!, cc);
  const deployer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, cc);
  const agg = process.env.CHAINLINK_AGGREGATOR_ADDRESS!;
  const chainKey = Number(process.env.SEPOLIA_CHAIN_KEY);

  const logs = await getLogsAtBlocks(src, { address: agg, topics: [ANSWER_UPDATED] }, [START_BLOCK, END_BLOCK]);
  if (logs.length < 2) throw new Error('could not fetch both outage boundary events');
  const events = logs
    .map((l) => ({ tx: l.transactionHash, block: l.blockNumber, ts: Number(BigInt(l.data)) }))
    .sort((a, b) => a.ts - b.ts);

  const gapMins = (events[1].ts - events[0].ts) / 60;
  console.log(`=== real outage: ${gapMins.toFixed(1)} min of silence ===`);
  console.log(`  ${new Date(events[0].ts * 1000).toISOString()} -> ${new Date(events[1].ts * 1000).toISOString()}`);

  const policy = {
    chainKey,
    sourceContract: agg,
    eventSignature: process.env.EVIDENCE_EVENT_SIGNATURE!,
    windowStart: events[0].ts,
    windowEnd: events[1].ts,
    windowStartBlock: START_BLOCK,
    windowEndBlock: END_BLOCK,
    toleranceSecs: TOLERANCE_SECS,
  };

  const asUw = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, COVER_ABI, underwriter);
  const tx1 = await asUw.createCover(policy, PREMIUM, { value: COLLATERAL });
  const rc1 = await tx1.wait();
  const created = rc1.logs
    .map((l: any) => { try { return asUw.interface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; } })
    .find((p: any) => p?.name === 'CoverCreated');
  const coverId = Number(created!.args[0]);
  console.log(`  cover #${coverId} created — ${tx1.hash}`);

  const asBuyer = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, COVER_ABI, buyer);
  const tx2 = await asBuyer.buyCover(coverId, { value: PREMIUM });
  await tx2.wait();
  console.log(`  purchased — ${tx2.hash}`);

  // Submit both boundary updates as real evidence, so the claim is decided by
  // proven facts rather than by an absence of submissions.
  const asc = new ethers.Contract(process.env.ATTESTABLE_ASC_ADDRESS!, ASC_ABI, deployer);
  const builder = new proofProvider.service.ProofBuilder(chainKey, process.env.PROOF_BUILDER_URL!);

  for (const e of events) {
    console.log(`\n  -> proving block ${e.block}`);
    const r = await builder.getProof(e.tx);
    if (!r.success || !r.data) { console.error(`     proof failed`); continue; }
    const p = r.data;
    const gas = BigInt(Math.max(600_000, 200_000 + p.continuityProof.roots.length * 6_000) + 200_000);
    const tx = await asc.submitEvidence(coverId, {
      chainKey: p.chainKey, blockHeight: p.headerNumber, encodedTransaction: p.txBytes,
      merkleRoot: p.merkleProof.root, siblings: p.merkleProof.siblings,
      lowerEndpointDigest: p.continuityProof.lowerEndpointDigest, continuityRoots: p.continuityProof.roots,
    }, { gasLimit: gas });
    const rc = await tx.wait();
    console.log(`     submitted: ${tx.hash} (gas ${rc.gasUsed})`);
  }

  const c = await asBuyer.getCover(coverId);
  console.log(`\n  evidenceCount : ${c.evidenceCount}`);
  console.log(`  maxGap        : ${c.maxGap}s (${(Number(c.maxGap) / 60).toFixed(1)} min)`);
  console.log(`  tolerance     : ${TOLERANCE_SECS}s (90 min)`);
  console.log(`\n  COVER_ID=${coverId}`);
}

main().catch((e) => { console.error('FAILED:', e.message ?? e); process.exit(1); });
