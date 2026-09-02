// Spike 1.3-1.5: resolve the real aggregator behind the proxy, discover which
// event it ACTUALLY emits (never assumed), and measure real update cadence.
import 'dotenv/config';
import { ethers } from 'ethers';

const PROXY = process.env.CHAINLINK_PROXY_ADDRESS!;

const PROXY_ABI = [
  'function aggregator() view returns (address)',
  'function description() view returns (string)',
  'function decimals() view returns (uint8)',
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
];

// Candidate event signatures. We do NOT assume which one the aggregator uses —
// we hash them all and match against topic0 of real observed logs.
const CANDIDATES = [
  'AnswerUpdated(int256,uint256,uint256)',
  'NewTransmission(uint32,int192,address,int192[],bytes,bytes32)',
  'NewTransmission(uint32,int192,address,uint32,int192[],bytes,bytes32,bytes32,uint40,bytes32)',
  'NewRound(uint256,address,uint256)',
  'ValidatorUpdated(address,address)',
];

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_RPC_URL!);

  console.log('=== 1.3 — Resolve the real emitter ===');
  const proxy = new ethers.Contract(PROXY, PROXY_ABI, provider);
  const aggregator: string = await proxy.aggregator();
  const description: string = await proxy.description();
  const decimals: number = Number(await proxy.decimals());

  console.log(`  proxy       : ${PROXY}`);
  console.log(`  description : ${description}`);
  console.log(`  decimals    : ${decimals}`);
  console.log(`  aggregator  : ${aggregator}`);

  const proxyCode = await provider.getCode(PROXY);
  const aggCode = await provider.getCode(aggregator);
  console.log(`  proxy bytecode      : ${(proxyCode.length - 2) / 2} bytes`);
  console.log(`  aggregator bytecode : ${(aggCode.length - 2) / 2} bytes`);
  if (aggregator.toLowerCase() === PROXY.toLowerCase()) {
    console.log('  NOTE: aggregator == proxy (unusual)');
  }

  console.log('\n=== 1.4 — Which event does it ACTUALLY emit? ===');
  const sigMap = new Map<string, string>();
  for (const sig of CANDIDATES) sigMap.set(ethers.id(sig), sig);

  const head = await provider.getBlockNumber();
  // Sepolia ~12s blocks; 7200 blocks ~= 24h
  const LOOKBACK = 7200;
  const from = head - LOOKBACK;

  console.log(`  scanning blocks ${from} .. ${head} (~24h) on the AGGREGATOR address`);

  const logs = await provider.getLogs({ address: aggregator, fromBlock: from, toBlock: head });
  console.log(`  logs found on aggregator: ${logs.length}`);

  const proxyLogs = await provider.getLogs({ address: PROXY, fromBlock: from, toBlock: head });
  console.log(`  logs found on proxy     : ${proxyLogs.length}  <- expected 0; proxies forward calls, not events`);

  const byTopic = new Map<string, number>();
  for (const l of logs) byTopic.set(l.topics[0], (byTopic.get(l.topics[0]) ?? 0) + 1);

  console.log('\n  topic0 breakdown:');
  for (const [topic, count] of [...byTopic.entries()].sort((a, b) => b[1] - a[1])) {
    const known = sigMap.get(topic);
    console.log(`    ${topic}  x${String(count).padStart(4)}  ${known ?? '<< UNRECOGNIZED >>'}`);
  }

  const answerUpdatedTopic = ethers.id('AnswerUpdated(int256,uint256,uint256)');
  const auLogs = logs.filter((l) => l.topics[0] === answerUpdatedTopic);
  console.log(`\n  AnswerUpdated present: ${auLogs.length > 0 ? `YES (${auLogs.length})` : 'NO'}`);

  console.log('\n=== 1.5 — Real update cadence ===');
  if (auLogs.length < 2) {
    console.log('  insufficient AnswerUpdated logs in window to measure cadence');
  } else {
    const withTimes: { block: number; ts: number }[] = [];
    for (const l of auLogs) {
      const b = await provider.getBlock(l.blockNumber);
      withTimes.push({ block: l.blockNumber, ts: b!.timestamp });
    }
    withTimes.sort((a, b) => a.ts - b.ts);

    const gaps: number[] = [];
    for (let i = 1; i < withTimes.length; i++) gaps.push(withTimes[i].ts - withTimes[i - 1].ts);

    const mins = (s: number) => (s / 60).toFixed(1);
    gaps.sort((a, b) => a - b);
    const sum = gaps.reduce((a, b) => a + b, 0);

    console.log(`  updates in ~24h : ${withTimes.length}`);
    console.log(`  min gap         : ${mins(gaps[0])} min`);
    console.log(`  median gap      : ${mins(gaps[Math.floor(gaps.length / 2)])} min`);
    console.log(`  max gap         : ${mins(gaps[gaps.length - 1])} min   <<< drives the staleness tolerance`);
    console.log(`  mean gap        : ${mins(sum / gaps.length)} min`);
    console.log(`\n  all gaps (min): ${gaps.map((g) => (g / 60).toFixed(0)).join(', ')}`);
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
