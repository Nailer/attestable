// Spike 1.14 — Ethereum mainnet (chainKey 3) probe.
//
// Mainnet counts as SUPPORTED only on a full end-to-end run ending in a real
// Creditcoin state change. Proof generation succeeding, an API returning 200, or
// the attestation dashboard showing the block do NOT qualify.
//
// This script does the read-only half: resolve the mainnet aggregator, find an
// attested AnswerUpdated, and generate a chainKey-3 proof. If that succeeds, a
// verifier is deployed for mainnet and the proof submitted.
import 'dotenv/config';
import { ethers } from 'ethers';
import { proofProvider, chainInfo } from '@gluwa/usc-sdk';
import { writeFileSync } from 'fs';

const MAINNET_PROXY = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419'; // Chainlink ETH/USD, mainnet
const ANSWER_UPDATED = ethers.id('AnswerUpdated(int256,uint256,uint256)');
const MAINNET_KEY = Number(process.env.MAINNET_CHAIN_KEY);

async function main() {
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const eth = new ethers.JsonRpcProvider(process.env.MAINNET_RPC_URL!);
  const info = new chainInfo.PrecompileChainInfoProvider(cc);
  const builder = new proofProvider.service.ProofBuilder(MAINNET_KEY, process.env.PROOF_BUILDER_URL!);

  console.log('=== 1.14 — Ethereum mainnet probe (chainKey 3) ===\n');

  const proxy = new ethers.Contract(
    MAINNET_PROXY,
    ['function aggregator() view returns (address)', 'function description() view returns (string)'],
    eth
  );
  const aggregator: string = await proxy.aggregator();
  console.log(`  proxy      : ${MAINNET_PROXY}`);
  console.log(`  description: ${await proxy.description()}`);
  console.log(`  aggregator : ${aggregator}`);

  const attested = await info.getLatestAttestedHeightAndHash(MAINNET_KEY);
  const head = await eth.getBlockNumber();
  console.log(`\n  mainnet head          : ${head}`);
  console.log(`  latest attested (cc)  : ${attested.height}  (lag ${head - attested.height} blocks)`);
  if (!attested.exists) throw new Error('no attestations exist for chainKey 3');

  console.log('\n  searching for an attested AnswerUpdated...');
  const from = attested.height - 800;
  const logs = await eth.getLogs({
    address: aggregator,
    topics: [ANSWER_UPDATED],
    fromBlock: from,
    toBlock: attested.height,
  });
  console.log(`  found ${logs.length} in blocks ${from}..${attested.height}`);
  if (logs.length === 0) throw new Error('no attested AnswerUpdated found in range');

  const log = logs[logs.length - 1];
  const receipt = await eth.getTransactionReceipt(log.transactionHash);
  console.log(`\n  candidate tx  : ${log.transactionHash}`);
  console.log(`  block         : ${log.blockNumber}`);
  console.log(`  receipt status: ${receipt!.status}`);
  console.log(`  topics        : ${log.topics.length}, data bytes: ${(log.data.length - 2) / 2}`);
  console.log(`  price         : $${(Number(BigInt(log.topics[1])) / 1e8).toFixed(2)}`);

  console.log('\n  generating chainKey-3 proof...');
  const t0 = Date.now();
  const pr = await builder.getProof(log.transactionHash);
  if (!pr.success || !pr.data) {
    console.log(`  PROOF GENERATION FAILED: ${(pr as any).error}`);
    console.log('\n  VERDICT: mainnet NOT supported for our purposes. Ship single-chain.');
    process.exit(2);
  }
  const p = pr.data;
  console.log(`  proof generated in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`    chainKey        : ${p.chainKey}`);
  console.log(`    headerNumber    : ${p.headerNumber}`);
  console.log(`    merkle siblings : ${p.merkleProof.siblings.length}`);
  console.log(`    continuity roots: ${p.continuityProof.roots.length}`);

  writeFileSync(
    'spike/mainnet-proof.json',
    JSON.stringify({ aggregator, txHash: log.transactionHash, block: log.blockNumber, proof: p }, null, 2)
  );
  console.log('\n  saved to spike/mainnet-proof.json');
  console.log('\n  READ-ONLY HALF SUCCEEDED. Deploy a chainKey-3 verifier and submit to complete 1.14.');
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
