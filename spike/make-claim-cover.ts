// Creates a cover guaranteed to CLAIM, so the claim path can be watched live.
//
// A 2-minute staleness tolerance against a feed that updates roughly hourly is
// economically absurd — no underwriter would ever write it. It is here purely to
// exercise the claim path end to end on real evidence, and the UI labels it as
// such rather than pretending it is a market-realistic policy.
import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';

const ABI = JSON.parse(readFileSync('contracts/abi/AttestableCover.json', 'utf8'));
const LEAD_MIN = 3;
const WINDOW_MIN = 10;
const TOLERANCE_SECS = 120; // 2 minutes

(async () => {
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const sep = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_SCAN_RPC!);
  const uw = new ethers.Wallet(process.env.UNDERWRITER_PRIVATE_KEY!, cc);
  const buyer = new ethers.Wallet(process.env.BUYER_PRIVATE_KEY!, cc);

  const head = await sep.getBlockNumber();
  const now = Math.floor(Date.now() / 1000);
  const leadSecs = LEAD_MIN * 60;
  const durationSecs = WINDOW_MIN * 60;
  const startBlock = head + Math.floor(leadSecs / 12);

  const policy = {
    chainKey: 1,
    sourceContract: process.env.CHAINLINK_AGGREGATOR_ADDRESS!,
    eventSignature: process.env.EVIDENCE_EVENT_SIGNATURE!,
    windowStart: now + leadSecs,
    windowEnd: now + leadSecs + durationSecs,
    windowStartBlock: startBlock,
    windowEndBlock: startBlock + Math.ceil(durationSecs / 12) + 50,
    toleranceSecs: TOLERANCE_SECS,
  };

  const c = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, ABI, uw);
  const tx = await c.createCover(policy, ethers.parseEther('12'), { value: ethers.parseEther('200') });
  const rc = await tx.wait();
  let id = 0;
  for (const l of rc.logs) {
    try {
      const p = c.interface.parseLog({ topics: [...l.topics], data: l.data });
      if (p?.name === 'CoverCreated') id = Number(p.args[0]);
    } catch { /* not ours */ }
  }
  console.log(`cover #${id} created  tx ${tx.hash}`);

  const cb = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, ABI, buyer);
  const b = await cb.buyCover(id, { value: ethers.parseEther('12') });
  await b.wait();
  console.log(`purchased            tx ${b.hash}`);

  console.log(`\n  tolerance   : ${TOLERANCE_SECS}s (2 min) vs an hourly feed -> WILL CLAIM`);
  console.log(`  window opens: ${new Date(policy.windowStart * 1000).toISOString()}`);
  console.log(`  window closes: ${new Date(policy.windowEnd * 1000).toISOString()}`);
  console.log(`  settleable  : ~${new Date((policy.windowEnd + 8 * 60) * 1000).toISOString()}`);
  console.log(`\n  COVER_ID=${id}`);
})();
