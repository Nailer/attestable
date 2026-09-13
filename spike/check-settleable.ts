import { ethers } from 'ethers';
import 'dotenv/config';
const cc = new ethers.JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network', { chainId: 102031, name: 'cc3' });
const COVER='0xB560596EcCfe690396E8BEC72EC0FaFFb6D87f89';
const ABI=['function getCover(uint256) view returns (tuple(address buyer,address underwriter,uint256 premium,uint256 collateral,tuple(uint64 chainKey,address sourceContract,bytes32 eventSignature,uint64 windowStart,uint64 windowEnd,uint64 windowStartBlock,uint64 windowEndBlock,uint32 toleranceSecs) policy,uint8 status,uint64 lastTimestamp,uint64 maxGap,uint32 evidenceCount))','function projectedMaxGap(uint256) view returns (uint64)'];
const CHAININFO='0x0000000000000000000000000000000000000FD3';
const CI=['function is_height_attested(uint64,uint64) view returns (bool)','function get_latest_attestation_height_and_hash(uint64) view returns (uint64,bytes32)'];
(async()=>{
  const c=new ethers.Contract(COVER,ABI,cc), ci=new ethers.Contract(CHAININFO,CI,cc);
  const now=Math.floor(Date.now()/1000);
  const [frontier]=await ci.get_latest_attestation_height_and_hash(1);
  console.log('attestation frontier (chainKey 1):', frontier.toString());
  console.log('now:', now, new Date(now*1000).toISOString());
  for (const id of [4,6]) {
    const v=await c.getCover(id); const p=v.policy;
    const proj=await c.projectedMaxGap(id);
    const attested=await ci.is_height_attested(1n, p.windowEndBlock);
    console.log(`\ncover ${id}: status=${v.status} ev=${v.evidenceCount}`);
    console.log('  windowEnd      :', p.windowEnd.toString(), new Date(Number(p.windowEnd)*1000).toISOString(), '=> closed:', now>=Number(p.windowEnd));
    console.log('  windowEndBlock :', p.windowEndBlock.toString(), '=> attested:', attested);
    console.log('  projectedMaxGap:', (Number(proj)/60).toFixed(1)+'min', ' tolerance:', (Number(p.toleranceSecs)/60).toFixed(1)+'min');
    console.log('  => SETTLEABLE NOW:', now>=Number(p.windowEnd) && attested, ' outcome would be:', Number(proj)>Number(p.toleranceSecs)?'CLAIMED':'HEALTHY');
  }
})();
