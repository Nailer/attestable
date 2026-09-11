import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
const ABI = JSON.parse(readFileSync('contracts/abi/AttestableCover.json','utf8'));
(async () => {
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const sep = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_SCAN_RPC!);
  const uw = new ethers.Wallet(process.env.UNDERWRITER_PRIVATE_KEY!, cc);
  const buyer = new ethers.Wallet(process.env.BUYER_PRIVATE_KEY!, cc);
  const head = await sep.getBlockNumber();
  // A window that has ALREADY closed, over recent still-queryable history, so
  // evidence exists to submit and settlement is immediately possible.
  const endBlock = head - 200;
  const endTs = (await sep.getBlock(endBlock))!.timestamp;
  const startTs = endTs - 4 * 3600;
  const policy = {
    chainKey: 1,
    sourceContract: process.env.CHAINLINK_AGGREGATOR_ADDRESS!,
    eventSignature: process.env.EVIDENCE_EVENT_SIGNATURE!,
    windowStart: startTs, windowEnd: endTs, windowEndBlock: endBlock, toleranceSecs: 5400,
  };
  const c = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, ABI, uw);
  const tx = await c.createCover(policy, ethers.parseEther('12'), { value: ethers.parseEther('200') });
  const rc = await tx.wait();
  let id = 0;
  for (const l of rc.logs) { try { const p = c.interface.parseLog({topics:[...l.topics],data:l.data}); if (p?.name==='CoverCreated') id = Number(p.args[0]); } catch {} }
  const cb = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, ABI, buyer);
  await (await cb.buyCover(id, { value: ethers.parseEther('12') })).wait();
  console.log(`COVER_ID=${id}  window ${new Date(startTs*1000).toISOString()} -> ${new Date(endTs*1000).toISOString()}  endBlock ${endBlock}`);
})();
