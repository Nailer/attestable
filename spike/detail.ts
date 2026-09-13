import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
const ABI = JSON.parse(readFileSync('contracts/abi/AttestableCover.json','utf8'));
(async () => {
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const c = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, ABI, cc);
  const S = ['OPEN','ACTIVE','HEALTHY','CLAIMED','CANCELLED'];
  const now = Math.floor(Date.now()/1000);
  for (let i=1;i<=5;i++){
    const v = await c.getCover(i);
    const proj = await c.projectedMaxGap(i);
    const dur = (Number(v.policy.windowEnd)-Number(v.policy.windowStart))/60;
    console.log(`cover ${i}: ${S[Number(v.status)].padEnd(9)} tol=${Number(v.policy.toleranceSecs)/60}min window=${dur}min evidence=${v.evidenceCount} maxGap=${(Number(v.maxGap)/60).toFixed(1)}min projected=${(Number(proj)/60).toFixed(1)}min closed=${now>=Number(v.policy.windowEnd)}`);
  }
})();
