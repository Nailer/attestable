import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
const ABI = JSON.parse(readFileSync('contracts/abi/AttestableCover.json','utf8'));
(async () => {
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const c = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, ABI, cc);
  const p = await c.getPolicy(1);
  const startBlock = Number(p.windowStartBlock);
  const endBlock = Number(p.windowEndBlock);
  const scanned = endBlock - 6000;
  console.log(`cover #1 policy`);
  console.log(`  windowStartBlock : ${startBlock}`);
  console.log(`  windowEndBlock   : ${endBlock}`);
  console.log(`  block span       : ${endBlock - startBlock}`);
  console.log(`  worker scanned   : ${scanned} .. ${endBlock}  (6000 blocks)`);
  console.log(`  BLOCKS MISSED    : ${Math.max(0, scanned - startBlock)} at the start of the window`);
  console.log(`  => scan covered the whole window: ${scanned <= startBlock}`);
})();
