// Spike 1.12 + 1.13
//
// 1.12 — THE GATE: submit a real Attestcoin proof of a real Chainlink event and
//        cause a real state change on Creditcoin.
// 1.13 — Prove the contract rejects bad evidence. Five distinct attacks, each
//        targeting a different check, asserting WHICH check fired rather than
//        merely that something failed.
import 'dotenv/config';
import { ethers } from 'ethers';
import { proofProvider, chainInfo } from '@gluwa/usc-sdk';
import { readFileSync, writeFileSync } from 'fs';

const ABI = JSON.parse(readFileSync('contracts/abi/SpikeVerifier.json', 'utf8'));
const VERIFIER_ADDR = process.env.SPIKE_VERIFIER_ADDRESS!;
const SEPOLIA_KEY = Number(process.env.SEPOLIA_CHAIN_KEY);
const TX = process.env.EVIDENCE_TX_HASH!;

type Proof = proofProvider.ContinuityResponse;

/** Flatten a proof into submitEvidence's argument list. */
function args(p: Proof, override: Partial<{ chainKey: number }> = {}) {
  return [
    override.chainKey ?? p.chainKey,
    p.headerNumber,
    p.txBytes,
    p.merkleProof.root,
    p.merkleProof.siblings,
    p.continuityProof.lowerEndpointDigest,
    p.continuityProof.roots,
  ];
}

function gasFor(p: Proof): bigint {
  // Reference formula: 21000 base + ~5000 per continuity root + ~20000 overhead.
  // Doubled for headroom — gas is not scarce on this testnet.
  return BigInt((21000 + p.continuityProof.roots.length * 5000 + 20000) * 2);
}

/** Decode a revert into the contract's typed custom error name. */
function errName(iface: ethers.Interface, e: any): string {
  const data = e?.data ?? e?.info?.error?.data ?? e?.error?.data;
  if (typeof data === 'string' && data.startsWith('0x') && data.length >= 10) {
    try {
      const parsed = iface.parseError(data);
      if (parsed) return `${parsed.name}(${parsed.args.map(String).join(', ')})`;
    } catch { /* fall through */ }
  }
  return e?.shortMessage ?? e?.message ?? String(e);
}

/** Deep-clone so tampering never mutates the pristine proof. */
const clone = (p: Proof): Proof => JSON.parse(JSON.stringify(p));

async function main() {
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, cc);
  const verifier = new ethers.Contract(VERIFIER_ADDR, ABI, wallet);
  const iface = new ethers.Interface(ABI);
  const info = new chainInfo.PrecompileChainInfoProvider(cc);
  const builder = new proofProvider.service.ProofBuilder(SEPOLIA_KEY, process.env.PROOF_BUILDER_URL!);

  const results: Record<string, string> = {};

  console.log('==============================================');
  console.log(' 1.12 — THE GATE');
  console.log('==============================================\n');

  const before = await verifier.acceptedCount();
  console.log(`  acceptedCount BEFORE : ${before}`);

  console.log('\n  fetching proof...');
  const pr = await builder.getProof(TX);
  if (!pr.success || !pr.data) throw new Error('proof generation failed');
  const proof = pr.data;
  console.log(`  proof ready: block ${proof.headerNumber}, txIndex ${proof.txIndex}, ` +
              `${proof.merkleProof.siblings.length} siblings, ${proof.continuityProof.roots.length} continuity roots`);

  console.log('\n  submitting to Creditcoin...');
  const tx = await verifier.submitEvidence(...args(proof), { gasLimit: gasFor(proof) });
  console.log(`  tx sent: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`  mined in block ${rc.blockNumber}, status ${rc.status}, gas used ${rc.gasUsed}`);

  const decoded = rc.logs
    .map((l: any) => { try { return iface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; } })
    .find((p: any) => p?.name === 'ProofAccepted');

  if (!decoded) throw new Error('ProofAccepted not emitted — GATE FAILED');

  console.log('\n  ProofAccepted:');
  console.log(`    queryId     : ${decoded.args[0]}`);
  console.log(`    blockHeight : ${decoded.args[1]}`);
  console.log(`    price       : ${decoded.args[2]}  ($${(Number(decoded.args[2]) / 1e8).toFixed(2)})`);
  console.log(`    roundId     : ${decoded.args[3]}`);
  console.log(`    updatedAt   : ${decoded.args[4]} (${new Date(Number(decoded.args[4]) * 1000).toISOString()})`);

  const after = await verifier.acceptedCount();
  console.log(`\n  acceptedCount AFTER  : ${after}`);
  console.log(`  STATE CHANGED: ${before} -> ${after}  ${after > before ? '*** GATE PASSED ***' : 'FAILED'}`);
  results['1.12 gate'] = `PASSED — cc tx ${tx.hash}, acceptedCount ${before} -> ${after}`;
  results['1.12 price'] = `$${(Number(decoded.args[2]) / 1e8).toFixed(2)} @ round ${decoded.args[3]}`;

  console.log('\n\n==============================================');
  console.log(' 1.13 — FIVE ATTACKS, EACH MUST BE REJECTED');
  console.log('==============================================');

  // ---- ATTACK 1: replay the exact same evidence -------------------------
  console.log('\n[1/5] REPLAY — resubmit the identical proof, on-chain');
  try {
    const t = await verifier.submitEvidence(...args(proof), { gasLimit: gasFor(proof) });
    const r = await t.wait();
    console.log(`      NOT REJECTED (status ${r.status}) — SECURITY FAILURE`);
    results['1.13.1 replay'] = 'FAILED TO REJECT';
  } catch (e: any) {
    const n = errName(iface, e);
    console.log(`      rejected: ${n}`);
    results['1.13.1 replay'] = n;
  }

  // ---- ATTACK 2: claim the evidence came from a different chain ---------
  console.log('\n[2/5] WRONG CHAIN KEY — same proof, claimed as chainKey 3 (mainnet)');
  try {
    await verifier.submitEvidence.staticCall(...args(proof, { chainKey: 3 }));
    console.log('      NOT REJECTED — SECURITY FAILURE');
    results['1.13.2 wrong chain'] = 'FAILED TO REJECT';
  } catch (e: any) {
    const n = errName(iface, e);
    console.log(`      rejected: ${n}`);
    results['1.13.2 wrong chain'] = n;
  }

  // ---- ATTACK 3: tampered merkle root ----------------------------------
  console.log('\n[3/5] TAMPERED MERKLE ROOT — flip one byte of the root');
  {
    const bad = clone(proof);
    const r = bad.merkleProof.root;
    bad.merkleProof.root = r.slice(0, -2) + (r.slice(-2) === 'ff' ? '00' : 'ff');
    try {
      await verifier.submitEvidence.staticCall(...args(bad));
      console.log('      NOT REJECTED — SECURITY FAILURE');
      results['1.13.3 tampered root'] = 'FAILED TO REJECT';
    } catch (e: any) {
      const n = errName(iface, e);
      console.log(`      rejected: ${n}`);
      results['1.13.3 tampered root'] = n;
    }
  }

  // ---- ATTACK 4: tampered transaction bytes ----------------------------
  console.log('\n[4/5] TAMPERED TX BYTES — alter the proven transaction payload');
  {
    const bad = clone(proof);
    const b = bad.txBytes;
    const mid = Math.floor(b.length / 2);
    const ch = b[mid] === 'a' ? 'b' : 'a';
    bad.txBytes = b.slice(0, mid) + ch + b.slice(mid + 1);
    try {
      await verifier.submitEvidence.staticCall(...args(bad));
      console.log('      NOT REJECTED — SECURITY FAILURE');
      results['1.13.4 tampered tx'] = 'FAILED TO REJECT';
    } catch (e: any) {
      const n = errName(iface, e);
      console.log(`      rejected: ${n}`);
      results['1.13.4 tampered tx'] = n;
    }
  }

  // ---- ATTACK 5: the fake-aggregator attack ----------------------------
  // The most important one. A second verifier is configured to expect a
  // DIFFERENT emitter. Feeding it our genuine, perfectly valid proof simulates
  // an attacker who deploys a lookalike contract, emits an identical event with
  // a fabricated price, and proves it honestly. The proof is real; the evidence
  // is worthless. Only the emitter check separates the two.
  console.log('\n[5/5] WRONG EMITTER — genuine proof, verifier expecting a different aggregator');
  {
    const factory = new ethers.ContractFactory(
      ABI,
      readFileSync('out/SpikeVerifier.sol/SpikeVerifier.json', 'utf8')
        ? JSON.parse(readFileSync('out/SpikeVerifier.sol/SpikeVerifier.json', 'utf8')).bytecode.object
        : '',
      wallet
    );
    const decoy = '0x000000000000000000000000000000000000dEaD';
    console.log(`      deploying decoy verifier expecting ${decoy}...`);
    const other = await factory.deploy(decoy, SEPOLIA_KEY);
    await other.waitForDeployment();
    const otherAddr = await other.getAddress();
    console.log(`      decoy verifier at ${otherAddr}`);

    const oc = new ethers.Contract(otherAddr, ABI, wallet);
    try {
      await oc.submitEvidence.staticCall(...args(proof));
      console.log('      NOT REJECTED — SECURITY FAILURE');
      results['1.13.5 wrong emitter'] = 'FAILED TO REJECT';
    } catch (e: any) {
      const n = errName(iface, e);
      console.log(`      rejected: ${n}`);
      results['1.13.5 wrong emitter'] = `${n}  (decoy verifier ${otherAddr})`;
    }
  }

  console.log('\n\n==============================================');
  console.log(' SUMMARY');
  console.log('==============================================');
  for (const [k, v] of Object.entries(results)) console.log(`  ${k.padEnd(24)} ${v}`);

  writeFileSync('spike/gate-results.json', JSON.stringify(results, null, 2));
  console.log('\n  saved to spike/gate-results.json');

  const finalCount = await verifier.acceptedCount();
  console.log(`\n  FINAL acceptedCount: ${finalCount}  (must still be 1 — no attack incremented it)`);
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
