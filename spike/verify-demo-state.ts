/**
 * Reads BOTH deployments the way the frontend now does, so the demo script is
 * written against verified chain state rather than memory.
 */
import { ethers } from 'ethers';
import 'dotenv/config';

const RPC = 'https://rpc.cc3-testnet.creditcoin.network';
const cc = new ethers.JsonRpcProvider(RPC, { chainId: 102031, name: 'cc3' });

const ABI = [
  'function nextCoverId() view returns (uint256)',
  'function getCover(uint256) view returns (tuple(address buyer,address underwriter,uint256 premium,uint256 collateral,tuple(uint64 chainKey,address sourceContract,bytes32 eventSignature,uint64 windowStart,uint64 windowEnd,uint64 windowStartBlock,uint64 windowEndBlock,uint32 toleranceSecs) policy,uint8 status,uint64 lastTimestamp,uint64 maxGap,uint32 evidenceCount))',
  'function projectedMaxGap(uint256) view returns (uint64)',
  'event CoverSettled(uint256 indexed coverId, uint8 outcome, address indexed paidTo, uint256 amount)',
];

const ARCHIVE_ABI = [
  'function nextCoverId() view returns (uint256)',
  'function getCover(uint256) view returns (tuple(address buyer,address underwriter,uint256 premium,uint256 collateral,tuple(uint64 chainKey,address sourceContract,bytes32 eventSignature,uint64 windowStart,uint64 windowEnd,uint64 windowEndBlock,uint32 toleranceSecs) policy,uint8 status,uint64 lastTimestamp,uint64 maxGap,uint32 evidenceCount))',
  'event CoverSettled(uint256 indexed coverId, uint8 outcome, address indexed paidTo, uint256 amount)',
];

const S = ['OPEN','ACTIVE','HEALTHY','CLAIMED','CANCELLED'];
const M = (s: bigint|number) => (Number(s)/60).toFixed(1)+'min';

async function dump(label: string, addr: string, legacy = false) {
  const c = new ethers.Contract(addr, legacy ? ARCHIVE_ABI : ABI, cc);
  const n = Number(await c.nextCoverId()) - 1;
  console.log(`\n=== ${label}  ${addr}  (${n} covers) ===`);
  for (let i = 1; i <= n; i++) {
    const v = await c.getCover(i);
    const proj = legacy ? v.maxGap : await c.projectedMaxGap(i);
    const p = v.policy;
    const settled = await c.queryFilter(c.filters.CoverSettled(i), 0, 'latest').catch(()=>[]);
    console.log(
      `cover ${i}: ${S[Number(v.status)].padEnd(9)}` +
      ` tol=${M(p.toleranceSecs).padEnd(8)}` +
      ` window=${M(Number(p.windowEnd)-Number(p.windowStart)).padEnd(9)}` +
      ` ev=${String(v.evidenceCount).padStart(2)}` +
      ` maxGap=${M(v.maxGap).padEnd(9)}` +
      ` proj=${M(proj).padEnd(9)}` +
      ` collat=${ethers.formatEther(v.collateral)}` +
      (settled.length ? `  settleTx=${settled[0].transactionHash}` : '')
    );
  }
}

(async () => {
  await dump('ARCHIVE', '0x87553eA864e4cd16357Fa3D0D27F9F4e831aDc91', true);
  await dump('CURRENT', '0xB560596EcCfe690396E8BEC72EC0FaFFb6D87f89');
  console.log('\nhead block:', await cc.getBlockNumber(), ' now:', Math.floor(Date.now()/1000));
})();
