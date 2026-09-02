// Spike 1.6: survey Sepolia Chainlink feeds for cadence behaviour. We need one
// reliable feed (HEALTHY demo) and ideally one that genuinely lapses (CLAIMED
// demo on real evidence). Candidates are probed, not trusted — anything that
// fails to respond is skipped and reported as unverified.
import 'dotenv/config';
import { ethers } from 'ethers';

const ANSWER_UPDATED = ethers.id('AnswerUpdated(int256,uint256,uint256)');

const CANDIDATES: Record<string, string> = {
  'ETH/USD': '0x694AA1769357215DE4FAC081bf1f309aDC325306',
  'BTC/USD': '0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43',
  'LINK/USD': '0xc59E3633BAAC79493d908e63626716e204A45EdF',
  'USDC/USD': '0xA2F78ab2355fe2f984D808B5CeE7FD0A93D5270E',
  'DAI/USD': '0x14866185B1962B63C3Ea9E03Bc1da838bab34C19',
  'EUR/USD': '0x1a81afB8146aeFfCFc5E50e8479e826E7D55b910',
  'GBP/USD': '0x91FAB41F5f3bE955963a986366edAcff1aaeaa83',
  'JPY/USD': '0x8A6af2B75F23831ADc973ce6288e5329F63D86c6',
  'BTC/ETH': '0x5fb1616F78dA7aFC9FF79e0371741a747D2a7F22',
  'SNX/USD': '0xc0F82A46033b8BdBA4Bb0B0e28Bc2006F64355bC',
  'XAU/USD': '0xC5981F461d74c46eB4b0CF3f4Ec79f025573B0Ea',
  'FORTH/USD': '0x070bF128E88A4520b3EfA65AB1e4Eb6F0F9E6632',
};

const PROXY_ABI = [
  'function aggregator() view returns (address)',
  'function description() view returns (string)',
];

const CHUNK = 5000;
const LOOKBACK = 21_600; // ~3 days at 12s blocks

async function getLogsChunked(provider: ethers.JsonRpcProvider, address: string, from: number, to: number) {
  const out: ethers.Log[] = [];
  for (let start = from; start <= to; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, to);
    try {
      const logs = await provider.getLogs({ address, fromBlock: start, toBlock: end, topics: [ANSWER_UPDATED] });
      out.push(...logs);
    } catch {
      // RPC range limit or transient failure — report partial rather than crash
    }
  }
  return out;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_RPC_URL!);
  const head = await provider.getBlockNumber();
  const from = head - LOOKBACK;

  console.log(`Scanning blocks ${from} .. ${head} (~3 days) for AnswerUpdated\n`);
  console.log('feed        updates  min gap  median   MAX GAP   verdict');
  console.log('-'.repeat(72));

  const results: { name: string; agg: string; count: number; maxGap: number; medGap: number }[] = [];

  for (const [name, proxyAddr] of Object.entries(CANDIDATES)) {
    let agg: string;
    try {
      const proxy = new ethers.Contract(proxyAddr, PROXY_ABI, provider);
      agg = await proxy.aggregator();
      await proxy.description();
    } catch {
      console.log(`${name.padEnd(11)} -- unreachable / not a valid feed proxy, skipped`);
      continue;
    }

    const logs = await getLogsChunked(provider, agg, from, head);
    if (logs.length < 2) {
      console.log(`${name.padEnd(11)} ${String(logs.length).padStart(7)}  (too few updates to measure)`);
      results.push({ name, agg, count: logs.length, maxGap: Infinity, medGap: Infinity });
      continue;
    }

    // Block timestamps, deduped
    const blocks = [...new Set(logs.map((l) => l.blockNumber))].sort((a, b) => a - b);
    const times: number[] = [];
    for (const b of blocks) {
      const blk = await provider.getBlock(b);
      if (blk) times.push(blk.timestamp);
    }
    times.sort((a, b) => a - b);

    const gaps: number[] = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    const sorted = [...gaps].sort((a, b) => a - b);
    const maxGap = sorted[sorted.length - 1];
    const medGap = sorted[Math.floor(sorted.length / 2)];
    const m = (s: number) => (s / 60).toFixed(0) + 'm';

    const verdict = maxGap > 3 * medGap ? 'IRREGULAR <<<' : maxGap > 7200 ? 'SLOW <<<' : 'steady';
    console.log(
      `${name.padEnd(11)} ${String(logs.length).padStart(7)}  ${m(sorted[0]).padStart(7)}  ${m(medGap).padStart(6)}  ${m(maxGap).padStart(8)}   ${verdict}`
    );
    results.push({ name, agg, count: logs.length, maxGap, medGap });
  }

  console.log('\n=== Candidates for the CLAIMED demo (longest real gaps) ===');
  results
    .filter((r) => Number.isFinite(r.maxGap))
    .sort((a, b) => b.maxGap - a.maxGap)
    .slice(0, 4)
    .forEach((r) => {
      console.log(`  ${r.name.padEnd(10)} max gap ${(r.maxGap / 60).toFixed(0)} min   aggregator ${r.agg}`);
    });
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
