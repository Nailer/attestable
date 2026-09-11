// Phase 3.2 — create and fund a real cover on Creditcoin.
//
// Underwriter posts collateral and sets terms; buyer pays the premium. Two
// distinct wallets, so the settlement transfer is visibly between two parties.
import 'dotenv/config';
import { ethers } from 'ethers';
import { chainInfo } from '@gluwa/usc-sdk';
import { readFileSync } from 'fs';
import { outageScenario, healthyScenario, Scenario } from './scenarios';

const COVER_ABI = JSON.parse(readFileSync('contracts/abi/AttestableCover.json', 'utf8'));

const COLLATERAL = ethers.parseEther('200');
const PREMIUM = ethers.parseEther('12');

async function main() {
  const which = process.argv[2] ?? 'outage';

  const cc = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const source = new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_SCAN_RPC ?? process.env.SOURCE_CHAIN_RPC_URL!);
  const info = new chainInfo.PrecompileChainInfoProvider(cc);

  const underwriter = new ethers.Wallet(process.env.UNDERWRITER_PRIVATE_KEY!, cc);
  const buyer = new ethers.Wallet(process.env.BUYER_PRIVATE_KEY!, cc);

  const chainKey = Number(process.env.SEPOLIA_CHAIN_KEY);
  const aggregator = process.env.CHAINLINK_AGGREGATOR_ADDRESS!;
  const attested = await info.getLatestAttestedHeightAndHash(chainKey);

  const scenario: Scenario =
    which === 'healthy'
      ? await healthyScenario(source, aggregator, attested.height)
      : await outageScenario(source);

  console.log(`=== creating "${scenario.name}" cover (expect ${scenario.expect}) ===`);
  console.log(`  ${scenario.note}`);
  console.log(`  window      : ${new Date(scenario.windowStart * 1000).toISOString()}`);
  console.log(`             .. ${new Date(scenario.windowEnd * 1000).toISOString()}`);
  console.log(`  span        : ${((scenario.windowEnd - scenario.windowStart) / 3600).toFixed(1)} hours`);
  console.log(`  tolerance   : ${scenario.toleranceSecs / 60} min`);
  console.log(`  windowEndBlk: ${scenario.windowEndBlock} (attested: ${attested.height >= scenario.windowEndBlock})`);

  const policy = {
    chainKey,
    sourceContract: aggregator,
    eventSignature: process.env.EVIDENCE_EVENT_SIGNATURE!,
    windowStart: scenario.windowStart,
    windowEnd: scenario.windowEnd,
    windowEndBlock: scenario.windowEndBlock,
    toleranceSecs: scenario.toleranceSecs,
  };

  const asUnderwriter = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, COVER_ABI, underwriter);
  console.log(`\n  underwriter ${underwriter.address} posting ${ethers.formatEther(COLLATERAL)} CTC...`);
  const tx1 = await asUnderwriter.createCover(policy, PREMIUM, { value: COLLATERAL });
  const rc1 = await tx1.wait();

  const created = rc1.logs
    .map((l: any) => {
      try {
        return asUnderwriter.interface.parseLog({ topics: [...l.topics], data: l.data });
      } catch {
        return null;
      }
    })
    .find((p: any) => p?.name === 'CoverCreated');
  const coverId = Number(created!.args[0]);
  console.log(`  created cover #${coverId} — tx ${tx1.hash}`);

  const asBuyer = new ethers.Contract(process.env.ATTESTABLE_COVER_ADDRESS!, COVER_ABI, buyer);
  console.log(`\n  buyer ${buyer.address} paying ${ethers.formatEther(PREMIUM)} CTC premium...`);
  const tx2 = await asBuyer.buyCover(coverId, { value: PREMIUM });
  await tx2.wait();
  console.log(`  purchased — tx ${tx2.hash}`);

  const c = await asBuyer.getCover(coverId);
  console.log(`\n  status        : ${['OPEN', 'ACTIVE', 'HEALTHY', 'CLAIMED', 'CANCELLED'][Number(c.status)]}`);
  console.log(`  escrow held   : ${ethers.formatEther(await cc.getBalance(process.env.ATTESTABLE_COVER_ADDRESS!))} CTC`);
  console.log(`\n  COVER_ID=${coverId}`);
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
