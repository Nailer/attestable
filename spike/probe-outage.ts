// Confirm the real 2026-08-31 outage boundary events are reachable via the
// archive endpoint, now that public endpoints no longer retain them.
import 'dotenv/config';
import { archiveProvider } from '../worker/rpc';
import { ANSWER_UPDATED } from '../worker/scenarios';

(async () => {
  const p = archiveProvider();
  const agg = process.env.CHAINLINK_AGGREGATOR_ADDRESS!;
  for (const b of [11602342, 11605987, 11609235]) {
    const logs = await p.getLogs({ address: agg, topics: [ANSWER_UPDATED], fromBlock: b, toBlock: b });
    const blk = await p.getBlock(b);
    console.log(`block ${b}: ${logs.length} logs · ts ${blk?.timestamp} (${new Date((blk?.timestamp ?? 0) * 1000).toISOString()})`);
    for (const l of logs) console.log(`   updatedAt=${BigInt(l.data)}  tx=${l.transactionHash}`);
  }
})();
