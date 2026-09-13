import { ethers } from 'ethers';
const cc = new ethers.JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network', { chainId: 102031, name: 'cc3' });
const A='0x87553eA864e4cd16357Fa3D0D27F9F4e831aDc91';
const ABI=['event CoverSettled(uint256 indexed coverId, uint8 outcome, address indexed paidTo, uint256 amount)'];
(async()=>{
  const head = await cc.getBlockNumber();
  console.log('head', head, 'archive deployBlock guess 5454395, span', head-5454395);
  const c = new ethers.Contract(A, ABI, cc);
  for (const from of [5454395, head-10000, head-100000]) {
    const t=Date.now();
    try {
      const logs = await c.queryFilter(c.filters.CoverSettled(1), from, 'latest');
      console.log(`from ${from}: ${logs.length} logs in ${Date.now()-t}ms`);
    } catch(e:any) { console.log(`from ${from}: ERROR after ${Date.now()-t}ms:`, (e.shortMessage??e.message).slice(0,120)); }
  }
})();
