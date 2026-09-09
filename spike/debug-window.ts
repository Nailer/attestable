import 'dotenv/config';
import { ethers } from 'ethers';
import { ANSWER_UPDATED } from '../worker/scenarios';

async function main() {
  const p = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_RPC_URL!);
  const agg = process.env.CHAINLINK_AGGREGATOR_ADDRESS!;
  const endBlock = 11_605_987;

  console.log('single 6000-block query (what the worker tried):');
  try {
    const l = await p.getLogs({ address: agg, topics: [ANSWER_UPDATED], fromBlock: endBlock - 6000, toBlock: endBlock });
    console.log(`  returned ${l.length} logs`);
  } catch (e: any) {
    console.log(`  ERROR: ${e.shortMessage ?? e.message}`);
  }

  console.log('\nchunked at 2000:');
  let total = 0;
  for (let s = endBlock - 6000; s <= endBlock; s += 2000) {
    const e = Math.min(s + 1999, endBlock);
    try {
      const l = await p.getLogs({ address: agg, topics: [ANSWER_UPDATED], fromBlock: s, toBlock: e });
      console.log(`  ${s}-${e}: ${l.length} logs`);
      total += l.length;
      for (const lg of l) {
        const updatedAt = Number(BigInt(lg.data));
        console.log(`     block ${lg.blockNumber} updatedAt ${updatedAt} ${new Date(updatedAt * 1000).toISOString()}`);
      }
    } catch (err: any) {
      console.log(`  ${s}-${e}: ERROR ${err.shortMessage ?? err.message}`);
    }
  }
  console.log(`  total: ${total}`);
}

main().catch((e) => console.error(e.message));
