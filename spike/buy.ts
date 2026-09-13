import 'dotenv/config'; import { ethers } from 'ethers';
import { readFileSync } from 'fs';
const ABI = JSON.parse(readFileSync('contracts/abi/AttestableCover.json','utf8'));
(async()=>{
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const buyer = new ethers.Wallet(process.env.BUYER_PRIVATE_KEY!, cc);
  const id = Number(process.argv[2]);
  const c = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, ABI, buyer);
  const v = await c.getCover(id);
  const now = Math.floor(Date.now()/1000);
  console.log(`cover ${id}: status=${['OPEN','ACTIVE','HEALTHY','CLAIMED','CANCELLED'][Number(v.status)]} premium=${ethers.formatEther(v.premium)}`);
  console.log(`  windowStart=${v.policy.windowStart} now=${now} secondsLeft=${Number(v.policy.windowStart)-now}`);
  if (Number(v.status) !== 0) { console.log('  not OPEN — nothing to do'); return; }
  const tx = await c.buyCover(id, { value: v.premium });
  await tx.wait();
  console.log(`  PURCHASED — tx ${tx.hash}`);
})();
