import { ethers } from 'ethers';
const cc=new ethers.JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network',{chainId:102031,name:'cc3'});
const ABI=['function getCover(uint256) view returns (tuple(address buyer,address underwriter,uint256 premium,uint256 collateral,tuple(uint64 chainKey,address sourceContract,bytes32 eventSignature,uint64 windowStart,uint64 windowEnd,uint64 windowEndBlock,uint32 toleranceSecs) policy,uint8 status,uint64 lastTimestamp,uint64 maxGap,uint32 evidenceCount))'];
(async()=>{
  const c=new ethers.Contract('0x87553eA864e4cd16357Fa3D0D27F9F4e831aDc91',ABI,cc);
  for(const id of [1,2,3]){
    const v=await c.getCover(id); const p=v.policy;
    console.log(`cover ${id}: ${['OPEN','ACTIVE','HEALTHY','CLAIMED','CANCELLED'][Number(v.status)]}`);
    console.log(`  window ${new Date(Number(p.windowStart)*1000).toISOString()} -> ${new Date(Number(p.windowEnd)*1000).toISOString()}`);
    console.log(`  endBlock ${p.windowEndBlock}  maxGap ${(Number(v.maxGap)/60).toFixed(1)}min  ev ${v.evidenceCount}`);
  }
})();
