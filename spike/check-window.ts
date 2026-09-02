// Spike 1.7 (continued): genesis height of 0 claims all history is provable.
// Verify by probing continuity bounds at increasing historical depths.
import 'dotenv/config';
import { ethers } from 'ethers';
import { chainInfo } from '@gluwa/usc-sdk';

const SEPOLIA_KEY = 1;

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const info = new chainInfo.PrecompileChainInfoProvider(provider);

  const chains = await info.getSupportedChains();
  console.log('Chain names (hex-decoded):');
  for (const c of chains) {
    console.log(`  chainKey ${c.chainKey}: "${ethers.toUtf8String(c.chainName)}" (chainId ${c.chainId})`);
  }

  const latest = await info.getLatestAttestedHeightAndHash(SEPOLIA_KEY);
  console.log(`\nSepolia latest attested: ${latest.height}\n`);

  // ~12s blocks: 300 = 1h, 7_200 = 1d, 50_400 = 1w, 216_000 = 1mo
  const depths = [
    ['1 hour', 300],
    ['1 day', 7_200],
    ['1 week', 50_400],
    ['1 month', 216_000],
    ['6 months', 1_296_000],
    ['1 year', 2_592_000],
  ] as const;

  console.log('Probing continuity bounds at historical depths:');
  console.log('(isAttested = true means a proof can be anchored for that height)\n');

  for (const [label, back] of depths) {
    const h = latest.height - back;
    if (h <= 0) continue;
    try {
      const b = await info.getContinuityBounds(SEPOLIA_KEY, h);
      console.log(
        `  ${label.padEnd(9)} back  block ${h}  attested=${String(b.isAttested).padEnd(5)}` +
        `  bounds [${b.parentHeight} .. ${b.childHeight}]  span=${b.childHeight - b.parentHeight}`
      );
    } catch (e: any) {
      console.log(`  ${label.padEnd(9)} back  block ${h}  ERROR: ${e.shortMessage ?? e.message}`);
    }
  }

  // Genesis boundary
  const genesis = await info.getAttestationGenesisHeight(SEPOLIA_KEY);
  console.log(`\nReported genesis height: ${genesis}`);
  try {
    const b = await info.getContinuityBounds(SEPOLIA_KEY, genesis + 1);
    console.log(`  block ${genesis + 1} (just above genesis): attested=${b.isAttested} bounds [${b.parentHeight} .. ${b.childHeight}]`);
  } catch (e: any) {
    console.log(`  block ${genesis + 1}: ERROR: ${e.shortMessage ?? e.message}`);
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
