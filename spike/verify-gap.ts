// Spike 1.6 verification: the survey reported ~600min max gaps across many
// independent feeds. That is either a real Sepolia-wide pause or an artifact of
// silently-failed RPC chunks. This re-scans with NO error suppression and
// cross-checks the suspected gap against actual block timestamps.
import 'dotenv/config';
import { ethers } from 'ethers';

const ANSWER_UPDATED = ethers.id('AnswerUpdated(int256,uint256,uint256)');
const ETH_USD_AGG = '0x719E22E3D4b690E5d96cCb40619180B5427F14AE';
const CHUNK = 5000;
const LOOKBACK = 21_600;

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_RPC_URL!);
  const head = await provider.getBlockNumber();
  const from = head - LOOKBACK;

  console.log(`Re-scanning ETH/USD aggregator ${ETH_USD_AGG}`);
  console.log(`blocks ${from} .. ${head}, chunk size ${CHUNK}, errors NOT suppressed\n`);

  const logs: ethers.Log[] = [];
  let failed = 0;

  for (let start = from; start <= head; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, head);
    try {
      const got = await provider.getLogs({ address: ETH_USD_AGG, fromBlock: start, toBlock: end, topics: [ANSWER_UPDATED] });
      console.log(`  chunk ${start}-${end}: ${got.length} logs  OK`);
      logs.push(...got);
    } catch (e: any) {
      failed++;
      console.log(`  chunk ${start}-${end}: FAILED -> ${e.shortMessage ?? e.message}`);
    }
  }

  console.log(`\nchunks failed: ${failed}  (any failure invalidates gap measurement)`);
  if (failed > 0) {
    console.log('SCAN INCOMPLETE — gaps cannot be trusted.');
    return;
  }

  const blocks = [...new Set(logs.map((l) => l.blockNumber))].sort((a, b) => a - b);
  const entries: { block: number; ts: number }[] = [];
  for (const b of blocks) {
    const blk = await provider.getBlock(b);
    if (blk) entries.push({ block: b, ts: blk.timestamp });
  }
  entries.sort((a, b) => a.ts - b.ts);

  console.log(`\ntotal updates: ${entries.length}`);
  console.log(`span: block ${entries[0].block} .. ${entries[entries.length - 1].block}\n`);

  // Report every gap over 2h, with the surrounding blocks so it can be checked by hand
  console.log('Gaps exceeding 120 minutes:');
  let found = 0;
  for (let i = 1; i < entries.length; i++) {
    const gap = entries[i].ts - entries[i - 1].ts;
    if (gap > 7200) {
      found++;
      const a = entries[i - 1], b = entries[i];
      console.log(`\n  GAP ${(gap / 60).toFixed(1)} min`);
      console.log(`    from block ${a.block}  ts ${a.ts}  ${new Date(a.ts * 1000).toISOString()}`);
      console.log(`    to   block ${b.block}  ts ${b.ts}  ${new Date(b.ts * 1000).toISOString()}`);
      console.log(`    blocks between: ${b.block - a.block}`);
      // Sanity: were blocks actually being produced during the gap?
      const mid = Math.floor((a.block + b.block) / 2);
      const midBlk = await provider.getBlock(mid);
      if (midBlk) {
        console.log(`    midpoint block ${mid} exists, ts ${midBlk.timestamp} ${new Date(midBlk.timestamp * 1000).toISOString()}`);
        console.log(`    => chain WAS producing blocks; the feed genuinely did not update`);
      } else {
        console.log(`    midpoint block ${mid} MISSING — chain itself may have stalled`);
      }
    }
  }
  if (found === 0) console.log('  none — no gap over 120 min in this window');
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
