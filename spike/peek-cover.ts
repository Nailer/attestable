/**
 * READ-ONLY. Looks at what evidence EXISTS in a cover's window and what the
 * outcome would be, without submitting anything -- so the live demo moment
 * stays unspent.
 */
import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
import { getLogsChunked } from '../worker/rpc';

const ABI = JSON.parse(readFileSync('contracts/abi/AttestableCover.json', 'utf8'));
const TOPIC = process.env.EVIDENCE_EVENT_SIGNATURE!;

(async () => {
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const src = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_RPC_URL!);
  const id = Number(process.argv[2] ?? 6);
  const c = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, ABI, cc);
  const v = await c.getCover(id);
  const p = v.policy;
  const now = Math.floor(Date.now() / 1000);

  const ci = new ethers.Contract('0x0000000000000000000000000000000000000FD3',
    ['function is_height_attested(uint64,uint64) view returns (bool)'], cc);
  const attested = await ci.is_height_attested(p.chainKey, p.windowEndBlock);

  console.log(`cover ${id}: status=${['OPEN','ACTIVE','HEALTHY','CLAIMED','CANCELLED'][Number(v.status)]}`);
  console.log(`  window   : ${new Date(Number(p.windowStart)*1000).toISOString()} .. ${new Date(Number(p.windowEnd)*1000).toISOString()}`);
  console.log(`  blocks   : ${p.windowStartBlock} .. ${p.windowEndBlock}`);
  console.log(`  closed   : ${now >= Number(p.windowEnd)}   attested: ${attested}`);
  console.log(`  tolerance: ${Number(p.toleranceSecs)/60} min   projected now: ${Number(await c.projectedMaxGap(id))/60} min`);

  const logs = await getLogsChunked(src,
    { address: p.sourceContract, topics: [TOPIC] },
    Number(p.windowStartBlock), Number(p.windowEndBlock), { quiet: true });

  const stamps: number[] = [];
  for (const l of logs) {
    const b = await src.getBlock(l.blockNumber);
    if (b && b.timestamp >= Number(p.windowStart) && b.timestamp <= Number(p.windowEnd)) stamps.push(b.timestamp);
  }
  stamps.sort((a, b) => a - b);

  console.log(`\n  qualifying updates inside the window: ${stamps.length}`);
  let prev = Number(p.windowStart), worst = 0;
  for (const t of stamps) {
    console.log(`    ${new Date(t*1000).toISOString()}   gap ${( (t-prev)/60 ).toFixed(1)} min`);
    worst = Math.max(worst, t - prev); prev = t;
  }
  worst = Math.max(worst, Number(p.windowEnd) - prev);
  console.log(`    (to window end)                      gap ${((Number(p.windowEnd)-prev)/60).toFixed(1)} min`);
  console.log(`\n  => after submitting all of them, worst gap = ${(worst/60).toFixed(1)} min`);
  console.log(`  => outcome would be: ${worst > Number(p.toleranceSecs) ? 'CLAIMED' : 'HEALTHY'}`);
})();
