/**
 * Simulate settle() without sending it. eth_call executes the exact same code
 * path against current state, so a clean return proves the live transaction
 * will succeed — without consuming the cover reserved for the demo.
 */
import { ethers } from 'ethers';
import 'dotenv/config';
const cc = new ethers.JsonRpcProvider('https://rpc.cc3-testnet.creditcoin.network', { chainId: 102031, name: 'cc3' });
const COVER='0xB560596EcCfe690396E8BEC72EC0FaFFb6D87f89';
const ABI=['function settle(uint256)','function getCover(uint256) view returns (tuple(address buyer,address underwriter,uint256 premium,uint256 collateral,tuple(uint64 chainKey,address sourceContract,bytes32 eventSignature,uint64 windowStart,uint64 windowEnd,uint64 windowStartBlock,uint64 windowEndBlock,uint32 toleranceSecs) policy,uint8 status,uint64 lastTimestamp,uint64 maxGap,uint32 evidenceCount))'];
(async()=>{
  const w = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY!, cc);
  const c = new ethers.Contract(COVER, ABI, w);
  const id = Number(process.argv[2] ?? 4);
  const v = await c.getCover(id);
  console.log(`cover ${id}: status=${v.status} collateral=${ethers.formatEther(v.collateral)} premium=${ethers.formatEther(v.premium)}`);
  try {
    await c.settle.staticCall(id);
    const gas = await c.settle.estimateGas(id);
    console.log(`SIMULATION PASSED — settle(${id}) will succeed. gas estimate: ${gas}`);
  } catch (e: any) {
    console.log('SIMULATION REVERTED:', e?.shortMessage ?? e?.message);
  }
})();
