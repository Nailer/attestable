// Step 2 verification against the LIVE contracts, not the local EVM.
import 'dotenv/config';
import { ethers } from 'ethers';
import { readFileSync } from 'fs';
const ABI = JSON.parse(readFileSync('contracts/abi/AttestableCover.json', 'utf8'));

(async () => {
  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const sep = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_SCAN_RPC!);
  const uw = new ethers.Wallet(process.env.UNDERWRITER_PRIVATE_KEY!, cc);
  const buyer = new ethers.Wallet(process.env.BUYER_PRIVATE_KEY!, cc);
  const c = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, ABI, uw);
  const iface = new ethers.Interface(ABI);

  const head = await sep.getBlockNumber();
  const now = Math.floor(Date.now() / 1000);
  const base = {
    chainKey: 1,
    sourceContract: process.env.CHAINLINK_AGGREGATOR_ADDRESS!,
    eventSignature: process.env.EVIDENCE_EVENT_SIGNATURE!,
    toleranceSecs: 5400,
  };

  const name = (e: any) => {
    for (const d of [e?.data, e?.info?.error?.data, e?.error?.data, e?.revert?.data]) {
      if (typeof d === 'string' && d.length >= 10) {
        try { const p = iface.parseError(d); if (p) return `${p.name}(${p.args.map(String).join(', ')})`; } catch {}
      }
    }
    return e?.shortMessage ?? e?.message;
  };

  console.log('=== A. end block that undershoots the window MUST be refused ===');
  try {
    await c.createCover.staticCall({
      ...base,
      windowStart: now + 900, windowEnd: now + 900 + 86400,
      windowStartBlock: head, windowEndBlock: head + 10, // 10 blocks for 24h
    }, ethers.parseEther('12'), { value: ethers.parseEther('200') });
    console.log('  NOT REFUSED — invariant is not live');
  } catch (e) { console.log('  refused:', name(e)); }

  console.log('\n=== B. a coherent forward-looking cover IS accepted ===');
  const good = {
    ...base,
    windowStart: now + 900,
    windowEnd: now + 900 + 86400,
    windowStartBlock: head + 75,
    windowEndBlock: head + 75 + Math.ceil(86400 / 12) + 50,
  };
  const tx = await c.createCover(good, ethers.parseEther('12'), { value: ethers.parseEther('200') });
  const rc = await tx.wait();
  let id = 0;
  for (const l of rc.logs) { try { const p = c.interface.parseLog({topics:[...l.topics],data:l.data}); if (p?.name==='CoverCreated') id = Number(p.args[0]); } catch {} }
  console.log(`  accepted — cover #${id}, tx ${tx.hash}`);

  console.log('\n=== C. buying BEFORE the window opens is allowed ===');
  const cb = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, ABI, buyer);
  const b = await cb.buyCover(id, { value: ethers.parseEther('12') });
  await b.wait();
  console.log(`  purchased — tx ${b.hash}`);

  console.log('\n=== D. a cover whose window already opened CANNOT be bought ===');
  const past = {
    ...base,
    windowStart: now - 7200, windowEnd: now - 3600,
    windowStartBlock: head - 800, windowEndBlock: head - 800 + Math.ceil(3600 / 12) + 20,
  };
  const tx2 = await c.createCover(past, ethers.parseEther('12'), { value: ethers.parseEther('200') });
  const rc2 = await tx2.wait();
  let id2 = 0;
  for (const l of rc2.logs) { try { const p = c.interface.parseLog({topics:[...l.topics],data:l.data}); if (p?.name==='CoverCreated') id2 = Number(p.args[0]); } catch {} }
  try {
    await cb.buyCover.staticCall(id2, { value: ethers.parseEther('12') });
    console.log('  NOT REFUSED — retrospective purchase still possible');
  } catch (e) { console.log(`  cover #${id2} refused:`, name(e)); }
})();
