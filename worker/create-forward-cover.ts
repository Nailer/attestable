// Creates a cover whose window lies in the FUTURE, which is the only kind the
// contract will sell: coverage cannot be bought once its window has opened,
// because a buyer who already knows the outcome is not buying insurance.
//
// The block bounds are projected forward from the current source head at
// Ethereum's fixed 12-second slot, and the end block is padded so it cannot
// undershoot the MIN_SOURCE_BLOCK_SECS floor the contract enforces.
import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const COVER_ABI = JSON.parse(readFileSync('contracts/abi/AttestableCover.json', 'utf8'));
const COLLATERAL = ethers.parseEther('200');
const PREMIUM = ethers.parseEther('12');

const LEAD_MINS = Number(process.argv[2] ?? 12);
const WINDOW_MINS = Number(process.argv[3] ?? 80);
const TOLERANCE_MINS = Number(process.argv[4] ?? 90);

async function main() {
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const source = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_SCAN_RPC ?? process.env.SOURCE_CHAIN_RPC_URL!);
  const underwriter = new ethers.Wallet(process.env.UNDERWRITER_PRIVATE_KEY!, cc);
  const buyer = new ethers.Wallet(process.env.BUYER_PRIVATE_KEY!, cc);

  const head = await source.getBlockNumber();
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now + LEAD_MINS * 60;
  const windowEnd = windowStart + WINDOW_MINS * 60;

  // 12s slots: project the block range the window will occupy.
  const startBlock = head + Math.floor((windowStart - now) / 12);
  const endBlock = startBlock + Math.ceil((WINDOW_MINS * 60) / 12) + 30; // pad past the floor

  const policy = {
    chainKey: Number(process.env.SEPOLIA_CHAIN_KEY),
    sourceContract: process.env.CHAINLINK_AGGREGATOR_ADDRESS!,
    eventSignature: process.env.EVIDENCE_EVENT_SIGNATURE!,
    windowStart,
    windowEnd,
    windowStartBlock: startBlock,
    windowEndBlock: endBlock,
    toleranceSecs: TOLERANCE_MINS * 60,
  };

  console.log('=== creating forward-window cover ===');
  console.log(`  opens   : ${new Date(windowStart * 1000).toISOString()} (in ${LEAD_MINS} min)`);
  console.log(`  closes  : ${new Date(windowEnd * 1000).toISOString()} (${WINDOW_MINS} min later)`);
  console.log(`  blocks  : ${startBlock} .. ${endBlock}  (source head now ${head})`);
  console.log(`  tolerance: ${TOLERANCE_MINS} min`);

  const asU = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, COVER_ABI, underwriter);
  try {
    await asU.createCover.staticCall(policy, PREMIUM, { value: COLLATERAL });
  } catch (e: any) {
    const data = e?.data ?? e?.info?.error?.data;
    if (data && data !== '0x') {
      const parsed = asU.interface.parseError(data);
      console.error('REVERT:', parsed?.name, parsed?.args?.map((a: any) => a.toString()).join(', '));
    } else {
      console.error('REVERT with no data:', e?.shortMessage ?? e?.message);
    }
    process.exit(1);
  }
  const tx1 = await asU.createCover(policy, PREMIUM, { value: COLLATERAL });
  const rc1 = await tx1.wait();
  const created = rc1.logs
    .map((l: any) => { try { return asU.interface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; } })
    .find((p: any) => p?.name === 'CoverCreated');
  const coverId = Number(created!.args[0]);
  console.log(`\n  created cover #${coverId} — tx ${tx1.hash}`);

  const asB = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, COVER_ABI, buyer);
  const tx2 = await asB.buyCover(coverId, { value: PREMIUM });
  await tx2.wait();
  console.log(`  purchased — tx ${tx2.hash}`);
  console.log(`\n  COVER_ID=${coverId}`);
  console.log(`  settleable once the attestation frontier passes block ${endBlock}`);
}
main().catch((e) => { console.error('FAILED:', e.shortMessage ?? e.message ?? e); process.exit(1); });
