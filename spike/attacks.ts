// Spike 1.13 — five attacks, each targeting a different check.
//
// METHODOLOGY NOTE (learned the hard way on the first run):
// SpikeVerifier checks replay protection BEFORE cryptographic verification, and
// the queryId is derived from (chainKey, blockHeight, txIndex) only. So tampering
// with the merkle root or the transaction bytes does NOT change the queryId —
// meaning a tampered copy of ALREADY-CONSUMED evidence gets rejected as a replay,
// not as a bad proof. The first run made exactly that mistake and produced two
// meaningless passes.
//
// Tampering attacks therefore run against FRESH, unconsumed evidence, so the
// rejection they trigger is genuinely the cryptographic one.
import 'dotenv/config';
import { ethers } from 'ethers';
import { proofProvider } from '@gluwa/usc-sdk';
import { readFileSync, writeFileSync } from 'fs';

const ABI = JSON.parse(readFileSync('contracts/abi/SpikeVerifier.json', 'utf8'));
const AGGREGATOR = process.env.CHAINLINK_AGGREGATOR_ADDRESS!;
const ANSWER_UPDATED = ethers.id('AnswerUpdated(int256,uint256,uint256)');
const SEPOLIA_KEY = Number(process.env.SEPOLIA_CHAIN_KEY);

type Proof = proofProvider.ContinuityResponse;
const clone = (p: Proof): Proof => JSON.parse(JSON.stringify(p));

function args(p: Proof, o: Partial<{ chainKey: number }> = {}) {
  return [
    o.chainKey ?? p.chainKey,
    p.headerNumber,
    p.txBytes,
    p.merkleProof.root,
    p.merkleProof.siblings,
    p.continuityProof.lowerEndpointDigest,
    p.continuityProof.roots,
  ];
}

function errName(iface: ethers.Interface, e: any): string {
  for (const d of [e?.data, e?.info?.error?.data, e?.error?.data, e?.revert?.data]) {
    if (typeof d === 'string' && d.startsWith('0x') && d.length >= 10) {
      try {
        const p = iface.parseError(d);
        if (p) return `${p.name}(${p.args.map(String).join(', ')})`;
      } catch { /* keep looking */ }
    }
  }
  if (e?.revert?.name) return `${e.revert.name}(${(e.revert.args ?? []).map(String).join(', ')})`;
  return e?.shortMessage ?? e?.message ?? String(e);
}

async function main() {
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const sep = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_RPC_URL!);
  const wallet = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, cc);
  const iface = new ethers.Interface(ABI);

  const main_ = new ethers.Contract(process.env.SPIKE_VERIFIER_ADDRESS!, ABI, wallet);
  const decoy = new ethers.Contract(process.env.DECOY_VERIFIER_ADDRESS!, ABI, wallet);
  const builder = new proofProvider.service.ProofBuilder(SEPOLIA_KEY, process.env.PROOF_BUILDER_URL!);

  const consumedTx = process.env.EVIDENCE_TX_HASH!;
  const consumedProof = (await builder.getProof(consumedTx)).data!;

  // Fresh evidence: a DIFFERENT AnswerUpdated the main verifier has never seen.
  console.log('Locating fresh, unconsumed evidence...');
  const head = await sep.getBlockNumber();
  const logs = await sep.getLogs({
    address: AGGREGATOR,
    topics: [ANSWER_UPDATED],
    fromBlock: head - 3000,
    toBlock: head - 100,
  });
  const freshLog = logs.find((l) => l.transactionHash.toLowerCase() !== consumedTx.toLowerCase());
  if (!freshLog) throw new Error('no fresh evidence found');
  console.log(`  fresh tx: ${freshLog.transactionHash} (block ${freshLog.blockNumber})`);

  const fresh = (await builder.getProof(freshLog.transactionHash)).data!;
  console.log(`  proof ready: ${fresh.continuityProof.roots.length} continuity roots\n`);

  const results: Record<string, { target: string; expected: string; got: string; pass: boolean }> = {};

  // `accept` lists every rejection reason that counts as a correct defence.
  // Tampered proofs are rejected by the PRECOMPILE, which reverts with a string
  // rather than returning false — so our own ProofRejected custom error is
  // never reached for those. Rejection is what matters; the layer that does it
  // is recorded, not assumed.
  async function attack(id: string, desc: string, contract: ethers.Contract, p: Proof, accept: string[], o = {}) {
    console.log(`[${id}] ${desc}`);
    try {
      await contract.submitEvidence.staticCall(...args(p, o));
      console.log('      *** NOT REJECTED — SECURITY FAILURE ***\n');
      results[id] = { target: desc, expected: accept.join(' | '), got: 'ACCEPTED', pass: false };
    } catch (e: any) {
      const got = errName(iface, e);
      const pass = accept.some((a) => got.includes(a));
      console.log(`      rejected: ${got}`);
      console.log(`      acceptable: ${accept.join(' | ')}  ->  ${pass ? 'PASS' : 'UNEXPECTED REASON'}\n`);
      results[id] = { target: desc, expected: accept.join(' | '), got, pass };
    }
  }

  console.log('==============================================');
  console.log(' 1.13 — FIVE ATTACKS');
  console.log('==============================================\n');

  await attack('A1', 'REPLAY — resubmit already-consumed evidence', main_, consumedProof, ['AlreadyConsumed']);
  await attack('A2', 'WRONG CHAIN KEY — genuine proof, claimed as mainnet', main_, fresh, ['WrongChainKey'], { chainKey: 3 });

  {
    const bad = clone(fresh);
    const r = bad.merkleProof.root;
    bad.merkleProof.root = r.slice(0, -2) + (r.slice(-2).toLowerCase() === 'ff' ? '00' : 'ff');
    await attack('A3', 'TAMPERED MERKLE ROOT — one byte flipped, fresh evidence', main_, bad, ['ProofRejected', 'Merkle proof validation failed', 'continuity']);
  }

  {
    const bad = clone(fresh);
    const b = bad.txBytes;
    const mid = Math.floor(b.length / 2);
    bad.txBytes = b.slice(0, mid) + (b[mid] === 'a' ? 'b' : 'a') + b.slice(mid + 1);
    await attack('A4', 'TAMPERED TX BYTES — payload altered, fresh evidence', main_, bad, ['ProofRejected', 'Merkle proof validation failed', 'continuity']);
  }

  // The most important one. A perfectly genuine, cryptographically valid proof
  // submitted to a verifier that expects a different aggregator. This simulates
  // an attacker deploying a lookalike contract, emitting an identical-shaped
  // event with a fabricated price, and proving it honestly. The proof is real;
  // the evidence is worthless. Only the emitter check separates the two.
  await attack('A5', 'WRONG EMITTER — valid proof, verifier expects another aggregator', decoy, fresh, ['WrongEmitter']);

  console.log('==============================================');
  console.log(' SUMMARY');
  console.log('==============================================');
  let allPass = true;
  for (const [id, r] of Object.entries(results)) {
    console.log(`  ${id}  ${r.pass ? 'PASS' : 'FAIL'}  ${r.got}`);
    if (!r.pass) allPass = false;
  }

  const finalCount = await main_.acceptedCount();
  console.log(`\n  acceptedCount: ${finalCount} — must still be 1; no attack may have incremented it`);
  console.log(`  OVERALL: ${allPass && finalCount === 1n ? 'ALL ATTACKS REJECTED' : 'REVIEW REQUIRED'}`);

  writeFileSync('spike/attack-results.json', JSON.stringify({ results, acceptedCount: finalCount.toString() }, null, 2));
  console.log('  saved to spike/attack-results.json');
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
