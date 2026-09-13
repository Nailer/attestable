// Read-only: what qualifying updates exist inside a cover's window?
// Submits nothing, so a cover reserved for a live demo stays untouched.
import 'dotenv/config';
import { ethers } from 'ethers';
const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
const src = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_SCAN_RPC ?? process.env.SOURCE_CHAIN_RPC_URL!);
const COVER=process.env.ATTESTABLE_COVER_ADDRESS!;
const ABI=['function getCover(uint256) view returns (tuple(address buyer,address underwriter,uint256 premium,uint256 collateral,tuple(uint64 chainKey,address sourceContract,bytes32 eventSignature,uint64 windowStart,uint64 windowEnd,uint64 windowStartBlock,uint64 windowEndBlock,uint32 toleranceSecs) policy,uint8 status,uint64 lastTimestamp,uint64 maxGap,uint32 evidenceCount))'];
(async()=>{
  const id=Number(process.argv[2]);
  const v=await new ethers.Contract(COVER,ABI,cc).getCover(id);
  const p=v.policy;
  const from=Number(p.windowStartBlock), to=Number(p.windowEndBlock);
  console.log(`cover ${id}: window ${new Date(Number(p.windowStart)*1000).toISOString()} .. ${new Date(Number(p.windowEnd)*1000).toISOString()}`);
  console.log(`  scanning source blocks ${from} .. ${to} (${to-from})`);
  const logs=await src.getLogs({address:p.sourceContract,topics:[p.eventSignature],fromBlock:from,toBlock:to});
  console.log(`  qualifying updates found: ${logs.length}`);
  for (const l of logs) {
    const b=await src.getBlock(l.blockNumber);
    const inWin = b!.timestamp>=Number(p.windowStart) && b!.timestamp<=Number(p.windowEnd);
    console.log(`    block ${l.blockNumber}  ${new Date(b!.timestamp*1000).toISOString()}  inWindow=${inWin}  tx=${l.transactionHash}`);
  }
})();
