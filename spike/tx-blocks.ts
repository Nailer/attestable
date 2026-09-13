import { ethers } from 'ethers';
const cc = new ethers.JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network', { chainId: 102031, name: 'cc3' });
const H = [
 ['settle cover1 HEALTHY','0x801da47a335bb11898d78c5fdc49b04e8af19ba75248017c7c0ab2ab2bd253aa'],
 ['settle cover2 CLAIMED','0xdf52e5adbb2ba5677225f4514981989f5730482cccc2fa11420c0ec5613f28cd'],
 ['settle cover3 HEALTHY','0x2c090c1d011660dd6de59aa938958394c03bf3258a9740b59b69baa2b7ba4187'],
 ['first real proof','0x7c738788da8d94543739b7a8797f43b7c9394ad663d51693e2bba5cbd713d4a1'],
];
(async()=>{
  let min=Infinity,max=0;
  for (const [label,h] of H) {
    const r = await cc.getTransactionReceipt(h);
    if (!r) { console.log(label,'NOT FOUND'); continue; }
    console.log(label.padEnd(24), 'block', r.blockNumber, 'status', r.status);
    min=Math.min(min,r.blockNumber); max=Math.max(max,r.blockNumber);
  }
  console.log('\narchive activity spans blocks', min, '..', max, '=', max-min);
  console.log('head', await cc.getBlockNumber());
})();
