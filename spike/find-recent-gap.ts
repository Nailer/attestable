// The August 31 outage window is no longer queryable — free Sepolia RPCs do not
// serve logs that far back. Scan the range that IS queryable for a genuine gap
// we can write a cover over, so the CLAIMED demo still uses real evidence.
import 'dotenv/config';
import { ethers } from 'ethers';
import { ANSWER_UPDATED } from '../worker/scenarios';

async function main() {
  const p = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_RPC_URL!);
  const agg = process.env.CHAINLINK_AGGREGATOR_ADDRESS!;
  const head = await p.getBlockNumber();

  console.log(`head: ${head}`);
  console.log('probing how far back getLogs is served...\n');

  // Binary-ish probe: find the oldest block where a log query still returns.
  let oldest = head;
  for (const back of [1000, 5000, 10000, 20000, 40000, 60000, 100000]) {
    const from = head - back;
    try {
      const l = await p.getLogs({ address: agg, topics: [ANSWER_UPDATED], fromBlock: from, toBlock: from + 999 });
      console.log(`  ${back} blocks back (${from}): ${l.length} logs — served`);
      if (l.length > 0) oldest = from;
    } catch (e: any) {
      console.log(`  ${back} blocks back (${from}): ${e.shortMessage ?? e.message}`);
      break;
    }
  }

  console.log(`\nscanning ${oldest}..${head} for gaps, chunked at 2000\n`);
  const events: { block: number; ts: number; tx: string }[] = [];
  for (let s = oldest; s <= head; s += 2000) {
    const e = Math.min(s + 1999, head);
    try {
      const logs = await p.getLogs({ address: agg, topics: [ANSWER_UPDATED], fromBlock: s, toBlock: e });
      for (const l of logs) {
        events.push({ block: l.blockNumber, ts: Number(BigInt(l.data)), tx: l.transactionHash });
      }
    } catch {
      /* skip unserved chunk */
    }
  }
  events.sort((a, b) => a.ts - b.ts);
  console.log(`collected ${events.length} updates`);
  if (events.length < 2) return;

  const gaps: { from: (typeof events)[0]; to: (typeof events)[0]; gap: number }[] = [];
  for (let i = 1; i < events.length; i++) {
    gaps.push({ from: events[i - 1], to: events[i], gap: events[i].ts - events[i - 1].ts });
  }
  gaps.sort((a, b) => b.gap - a.gap);

  console.log('\nlargest gaps in the queryable range:');
  for (const g of gaps.slice(0, 5)) {
    console.log(
      `  ${(g.gap / 60).toFixed(1)} min  blocks ${g.from.block} -> ${g.to.block}  ` +
        `${new Date(g.from.ts * 1000).toISOString()} -> ${new Date(g.to.ts * 1000).toISOString()}`
    );
  }

  const biggest = gaps[0];
  console.log(`\nBIGGEST: ${(biggest.gap / 60).toFixed(1)} min`);
  console.log(`  exceeds 90-min tolerance: ${biggest.gap > 5400 ? 'YES — usable for a CLAIMED cover' : 'NO'}`);
  console.log(`  windowStart     = ${biggest.from.ts}`);
  console.log(`  windowEnd       = ${biggest.to.ts}`);
  console.log(`  windowEndBlock  = ${biggest.to.block}`);
  console.log(`  earliest usable block for scanning = ${oldest}`);
}

main().catch((e) => console.error('FAILED:', e.message ?? e));
