// Spike 1.8 + 1.8A: select a real source transaction and decode its event BY HAND
// from raw bytes, cross-checking against the library. The product's core claim is
// "this exact external event caused this financial decision" — that chain of
// reasoning must be reproducible manually, not taken on a library's word.
import 'dotenv/config';
import { ethers } from 'ethers';
import { chainInfo } from '@gluwa/usc-sdk';

const AGGREGATOR = '0x719E22E3D4b690E5d96cCb40619180B5427F14AE';
const EVENT_SIG = 'AnswerUpdated(int256,uint256,uint256)';
const SEPOLIA_KEY = 1;

// Creditcoin's precompile calls occasionally time out. Transient, confirmed by
// probing the RPC separately. The worker will need this same resilience.
async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      console.log(`    (${label}: attempt ${i}/${attempts} failed, retrying in ${i * 2}s)`);
      await new Promise((r) => setTimeout(r, i * 2000));
    }
  }
  throw lastErr;
}

function hexSlice(data: string, wordIndex: number): string {
  const start = 2 + wordIndex * 64;
  return '0x' + data.slice(start, start + 64);
}

// int256 from a 32-byte two's-complement word
function toInt256(word: string): bigint {
  const v = BigInt(word);
  const TWO255 = 1n << 255n;
  return v >= TWO255 ? v - (1n << 256n) : v;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_RPC_URL!);
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const info = new chainInfo.PrecompileChainInfoProvider(cc);

  const topic0 = ethers.id(EVENT_SIG);
  console.log('=== 1.8 — Select a real source transaction ===');
  console.log(`  event signature : ${EVENT_SIG}`);
  console.log(`  keccak256       : ${topic0}`);

  // Only consider blocks already attested, so the choice is provable now.
  const latestAttested = await withRetry('latest attested height', () =>
    info.getLatestAttestedHeightAndHash(SEPOLIA_KEY)
  );
  console.log(`  latest attested Sepolia height: ${latestAttested.height}`);

  const from = latestAttested.height - 2000;
  const logs = await provider.getLogs({
    address: AGGREGATOR,
    topics: [topic0],
    fromBlock: from,
    toBlock: latestAttested.height,
  });

  if (logs.length === 0) throw new Error('no AnswerUpdated logs in the attested range');

  // Take the most recent attested one
  const log = logs[logs.length - 1];
  const receipt = await provider.getTransactionReceipt(log.transactionHash);
  const block = await provider.getBlock(log.blockNumber);
  if (!receipt || !block) throw new Error('could not load receipt/block');

  console.log('\n  SELECTED EVIDENCE TRANSACTION');
  console.log(`    tx hash        : ${log.transactionHash}`);
  console.log(`    block number   : ${log.blockNumber}`);
  console.log(`    block hash     : ${log.blockHash}`);
  console.log(`    block timestamp: ${block.timestamp}  (${new Date(block.timestamp * 1000).toISOString()})`);
  console.log(`    log index      : ${log.index}`);
  console.log(`    emitter        : ${log.address}`);
  console.log(`    receipt status : ${receipt.status}  ${receipt.status === 1 ? '(success)' : '(FAILED — unusable)'}`);
  console.log(`    tx from        : ${receipt.from}   <- gas payer, NOT identity. Never bind policy to this.`);
  console.log(`    tx to          : ${receipt.to}`);
  console.log(`    logs in tx     : ${receipt.logs.length}`);

  console.log('\n=== 1.8A — Decode the event BY HAND from raw bytes ===');
  console.log('\n  Raw log:');
  console.log(`    address : ${log.address}`);
  log.topics.forEach((t, i) => console.log(`    topics[${i}]: ${t}`));
  console.log(`    data    : ${log.data}`);
  console.log(`    data len: ${(log.data.length - 2) / 2} bytes = ${(log.data.length - 2) / 64} words`);

  console.log('\n  Step 1 — verify topics[0] is the event signature hash');
  const sigMatch = log.topics[0] === topic0;
  console.log(`    keccak256("${EVENT_SIG}")`);
  console.log(`      computed = ${topic0}`);
  console.log(`      observed = ${log.topics[0]}`);
  console.log(`      match    = ${sigMatch ? 'YES' : 'NO'}`);

  console.log('\n  Step 2 — determine the ACTUAL indexing layout from the raw log');
  console.log(`      topic count : ${log.topics.length}  (1 signature + ${log.topics.length - 1} indexed params)`);
  console.log(`      data words  : ${(log.data.length - 2) / 64}  (non-indexed params)`);
  console.log('');
  console.log('    The event has 3 parameters. With 2 indexed and 1 in data, the real');
  console.log('    declaration must be:');
  console.log('      AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)');
  console.log('');
  console.log('    NOTE: the signature hash is IDENTICAL whether or not params are indexed,');
  console.log('    so topic0 matching does NOT confirm the layout. Assuming only roundId was');
  console.log('    indexed would decode garbage while every signature check still passed.');

  const current = toInt256(log.topics[1]);
  const roundId = BigInt(log.topics[2]);
  console.log(`\n      topics[1] -> int256 current = ${current}  (8 decimals => $${(Number(current) / 1e8).toFixed(2)})`);
  console.log(`      topics[2] -> uint256 roundId = ${roundId}`);

  console.log('\n  Step 3 — non-indexed parameter from data');
  const word0 = hexSlice(log.data, 0);
  const updatedAt = BigInt(word0);
  console.log(`      data word[0] = ${word0}`);
  console.log(`        -> uint256 updatedAt = ${updatedAt}  (${new Date(Number(updatedAt) * 1000).toISOString()})`);

  console.log('\n  Step 4 — cross-check against the library using the corrected layout');
  const iface = new ethers.Interface([
    'event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)',
  ]);
  const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
  const libCurrent = parsed!.args[0] as bigint;
  const libRound = parsed!.args[1] as bigint;
  const libUpdated = parsed!.args[2] as bigint;
  console.log(`      library: current=${libCurrent} roundId=${libRound} updatedAt=${libUpdated}`);
  const agree = libCurrent === current && libRound === roundId && libUpdated === updatedAt;
  console.log(`      hand-decoded matches library: ${agree ? 'YES' : 'NO — INVESTIGATE'}`);
  if (!agree) process.exit(1);

  console.log('\n  Step 5 — sanity-check the decoded price against the live feed');
  const proxy = new ethers.Contract(
    process.env.CHAINLINK_PROXY_ADDRESS!,
    ['function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)'],
    provider
  );
  const [, liveAnswer] = await proxy.latestRoundData();
  console.log(`      decoded from log : $${(Number(current) / 1e8).toFixed(2)}`);
  console.log(`      live feed now    : $${(Number(liveAnswer) / 1e8).toFixed(2)}`);
  console.log('      (should be the same order of magnitude — confirms we decoded a price, not noise)');

  console.log('\n=== Open question resolved: which timestamp is authoritative? ===');
  const drift = block.timestamp - Number(updatedAt);
  console.log(`    event updatedAt  : ${updatedAt}  (${new Date(Number(updatedAt) * 1000).toISOString()})`);
  console.log(`    block timestamp  : ${block.timestamp}  (${new Date(block.timestamp * 1000).toISOString()})`);
  console.log(`    drift            : ${drift} s`);
  console.log('\n    RECOMMENDATION: use the event\'s own updatedAt.');
  console.log('    It is carried inside the proven log data, so it is covered by the same');
  console.log('    Merkle/receipt proof as the rest of the evidence. Block timestamp would');
  console.log('    require separately trusting a header field the receipt proof does not cover.');
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
