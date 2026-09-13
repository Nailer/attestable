import 'dotenv/config'; import { ethers } from 'ethers';
const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
(async()=>{
  for (const [n,k] of [['deployer','DEPLOYER'],['buyer','BUYER'],['underwriter','UNDERWRITER']] as const) {
    const w = new ethers.Wallet(process.env[`${k}_PRIVATE_KEY`]!, cc);
    console.log(n.padEnd(12), w.address, ethers.formatEther(await cc.getBalance(w.address)), 'CTC');
  }
  console.log('escrow      ', '0xB560596EcCfe690396E8BEC72EC0FaFFb6D87f89', ethers.formatEther(await cc.getBalance('0xB560596EcCfe690396E8BEC72EC0FaFFb6D87f89')), 'CTC');
})();
