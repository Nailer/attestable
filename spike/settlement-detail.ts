import 'dotenv/config'; import { ethers } from 'ethers';
const cc = new ethers.JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network',{chainId:102031,name:'cc3'});
const H=[
 ['cover 1 HEALTHY','0x801da47a335bb11898d78c5fdc49b04e8af19ba75248017c7c0ab2ab2bd253aa'],
 ['cover 2 CLAIMED','0xdf52e5adbb2ba5677225f4514981989f5730482cccc2fa11420c0ec5613f28cd'],
 ['cover 3 HEALTHY','0x2c090c1d011660dd6de59aa938958394c03bf3258a9740b59b69baa2b7ba4187'],
 ['first proof   ','0x7c738788da8d94543739b7a8797f43b7c9394ad663d51693e2bba5cbd713d4a1'],
];
(async()=>{
  for(const [l,h] of H){
    const r=await cc.getTransactionReceipt(h);
    if(!r){console.log(l,'NOT FOUND');continue;}
    const b=await cc.getBlock(r.blockNumber);
    console.log(`${l} block=${r.blockNumber} gas=${r.gasUsed} status=${r.status} logs=${r.logs.length} ts=${new Date(Number(b!.timestamp)*1000).toISOString()}`);
  }
  console.log('\nchainId', (await cc.getNetwork()).chainId.toString());
})();
