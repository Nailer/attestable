import { ethers } from 'ethers';
const cc = new ethers.JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network', { chainId: 102031, name: 'cc3' });
const A='0x87553eA864e4cd16357Fa3D0D27F9F4e831aDc91';
const ABI=['function getCover(uint256) view returns (tuple(address buyer,address underwriter,uint256 premium,uint256 collateral,tuple(uint64 chainKey,address sourceContract,bytes32 eventSignature,uint64 windowStart,uint64 windowEnd,uint64 windowEndBlock,uint32 toleranceSecs) policy,uint8 status,uint64 lastTimestamp,uint64 maxGap,uint32 evidenceCount))'];
const S=['OPEN','ACTIVE','HEALTHY','CLAIMED','CANCELLED'];
const iso=(n:any)=>new Date(Number(n)*1000).toISOString().replace('T',' ').slice(0,16)+' UTC';
(async()=>{
  const c=new ethers.Contract(A,ABI,cc);
  for (const id of [1,2,3]) {
    const v=await c.getCover(id); const p=v.policy;
    console.log(`\n--- ARCHIVE cover ${id}: ${S[Number(v.status)]} ---`);
    console.log('  window   :', iso(p.windowStart), '->', iso(p.windowEnd));
    console.log('  span     :', ((Number(p.windowEnd)-Number(p.windowStart))/3600).toFixed(1),'h');
    console.log('  tolerance:', (Number(p.toleranceSecs)/60).toFixed(0),'min');
    console.log('  maxGap   :', (Number(v.maxGap)/60).toFixed(1),'min');
    console.log('  proofs   :', Number(v.evidenceCount));
    console.log('  buyer    :', v.buyer);
    console.log('  underwrtr:', v.underwriter);
  }
})();
