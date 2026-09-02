// Spike 1.9: generate a real Attestcoin proof for the selected evidence
// transaction, timing every stage. Also probes the batch-proof API, which
// determines whether many proofs can share one continuity proof (spike item 9).
import 'dotenv/config';
import { ethers } from 'ethers';
import { proofProvider, chainInfo } from '@gluwa/usc-sdk';
import { writeFileSync } from 'fs';

const SEPOLIA_KEY = Number(process.env.SEPOLIA_CHAIN_KEY);
const TX = process.env.EVIDENCE_TX_HASH!;
const BLOCK = Number(process.env.EVIDENCE_BLOCK);

const t0 = Date.now();
const stamp = (label: string) => console.log(`  [+${((Date.now() - t0) / 1000).toFixed(2)}s] ${label}`);

async function main() {
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const info = new chainInfo.PrecompileChainInfoProvider(cc);
  const builder = new proofProvider.service.ProofBuilder(SEPOLIA_KEY, process.env.PROOF_BUILDER_URL!);

  console.log('=== 1.9 — Generate a real Attestcoin proof ===');
  console.log(`  tx      : ${TX}`);
  console.log(`  block   : ${BLOCK}`);
  console.log(`  chainKey: ${SEPOLIA_KEY}\n`);

  stamp('checking attestation frontier');
  const latest = await info.getLatestAttestedHeightAndHash(SEPOLIA_KEY);
  console.log(`         latest attested = ${latest.height}, our block = ${BLOCK}`);
  console.log(`         already attested: ${latest.height >= BLOCK ? 'YES' : 'NO — will wait'}`);

  stamp('waiting until height attested (returns immediately if already past)');
  await builder.waitUntilHeightAttested(SEPOLIA_KEY, BLOCK, 15_000, 1_200_000);
  stamp('attestation confirmed');

  stamp('requesting proof from Proof Builder');
  const result = await builder.getProof(TX);
  stamp('proof returned');

  if (!result.success || !result.data) {
    console.error('\nPROOF FAILED:', (result as any).error);
    process.exit(1);
  }

  const p = result.data;
  console.log('\n  PROOF CONTENTS');
  console.log(`    chainKey            : ${p.chainKey}`);
  console.log(`    headerNumber        : ${p.headerNumber}`);
  console.log(`    txIndex             : ${p.txIndex}`);
  console.log(`    txHash              : ${p.txHash}`);
  console.log(`    txBytes length      : ${(p.txBytes.length - 2) / 2} bytes  <- encoded tx + receipt`);
  console.log(`    merkle root         : ${p.merkleProof.root}`);
  console.log(`    merkle siblings     : ${p.merkleProof.siblings.length}`);
  console.log(`    continuity lower    : ${p.continuityProof.lowerEndpointDigest}`);
  console.log(`    continuity roots    : ${p.continuityProof.roots.length}   <- drives gas cost`);
  console.log(`    served from cache   : ${p.cached}`);

  console.log('\n  Sanity: does txHash in the proof match what we asked for?');
  console.log(`    requested: ${TX}`);
  console.log(`    returned : ${p.txHash}`);
  console.log(`    match    : ${p.txHash.toLowerCase() === TX.toLowerCase() ? 'YES' : 'NO — INVESTIGATE'}`);

  writeFileSync('spike/proof-sample.json', JSON.stringify(result.data, null, 2));
  console.log('\n  Full proof saved to spike/proof-sample.json');

  // Spike item 9: can several proofs share one continuity proof?
  console.log('\n=== Batch proof probe (spike item 9) ===');
  try {
    const bt0 = Date.now();
    const batch = await builder.getBatchProof([TX]);
    console.log(`  getBatchProof([1 tx]) returned in ${((Date.now() - bt0) / 1000).toFixed(2)}s`);
    console.log(`  keys: ${Object.keys(batch as object).join(', ')}`);
    writeFileSync('spike/batch-sample.json', JSON.stringify(batch, null, 2));
    console.log('  saved to spike/batch-sample.json');
  } catch (e: any) {
    console.log(`  batch probe failed: ${e.shortMessage ?? e.message}`);
  }

  console.log(`\n  TOTAL ELAPSED: ${((Date.now() - t0) / 1000).toFixed(2)}s`);
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
