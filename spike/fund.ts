import 'dotenv/config'; import { ethers } from 'ethers';
const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
(async()=>{
  const from = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, cc);
  const to = new ethers.Wallet(process.env.UNDERWRITER_PRIVATE_KEY!, cc).address;
  const amt = ethers.parseEther(process.argv[2] ?? '600');
  const tx = await from.sendTransaction({ to, value: amt });
  await tx.wait();
  console.log(`funded underwriter ${to} with ${ethers.formatEther(amt)} CTC — tx ${tx.hash}`);
  console.log('underwriter balance now:', ethers.formatEther(await cc.getBalance(to)), 'CTC');
})();
