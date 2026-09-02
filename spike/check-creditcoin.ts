// Spike 1.2 + 1.7: verify Creditcoin's live configuration and measure the
// provable historical window via the ChainInfo precompile. Read-only.
import 'dotenv/config';
import { ethers } from 'ethers';
import { chainInfo } from '@gluwa/usc-sdk';

const CREDITCOIN_RPC = process.env.CREDITCOIN_RPC_URL!;
const SEPOLIA_RPC = process.env.SOURCE_CHAIN_RPC_URL!;
const MAINNET_RPC = process.env.MAINNET_RPC_URL!;

async function headOf(rpc: string): Promise<number | null> {
  try {
    return await new ethers.JsonRpcProvider(rpc).getBlockNumber();
  } catch {
    return null;
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(CREDITCOIN_RPC);
  const info = new chainInfo.PrecompileChainInfoProvider(provider);

  console.log('=== 1.2 — ChainInfo precompile (0x0FD3) ===');
  const chains = await info.getSupportedChains();
  console.log(`Precompile responded. ${chains.length} supported source chain(s):\n`);
  for (const c of chains) {
    console.log(`  chainKey ${c.chainKey}  ${c.chainName}`);
    console.log(`    native chainId: ${c.chainId}   encoding version: ${c.chainEncoding}`);
  }

  console.log('\n=== 1.7 — Provable historical window ===');
  const sourceHeads: Record<number, number | null> = {
    1: await headOf(SEPOLIA_RPC),
    3: await headOf(MAINNET_RPC),
  };

  for (const c of chains) {
    const key = c.chainKey;
    console.log(`\n  --- chainKey ${key} (${c.chainName}) ---`);

    const latest = await info.getLatestAttestedHeightAndHash(key);
    if (!latest.exists) {
      console.log('    NO ATTESTATIONS EXIST for this chain.');
      continue;
    }

    const genesis = await info.getAttestationGenesisHeight(key);
    const head = sourceHeads[key];

    console.log(`    attestation genesis height : ${genesis}`);
    console.log(`    latest attested height     : ${latest.height}`);
    console.log(`    latest attested digest     : ${latest.hash}`);
    console.log(`    is attestation (not checkpoint): ${latest.isAttestation}`);
    console.log(`    => PROVABLE WINDOW: blocks ${genesis} .. ${latest.height}`);
    console.log(`       window span: ${latest.height - genesis} blocks`);

    if (head !== null) {
      const lag = head - latest.height;
      const lagSecs = key === 1 || key === 3 ? lag * 12 : null; // ~12s Ethereum blocks
      console.log(`    source chain head          : ${head}`);
      console.log(`    ATTESTATION LAG            : ${lag} blocks` +
        (lagSecs !== null ? ` (~${(lagSecs / 60).toFixed(1)} min behind head)` : ''));
    } else {
      console.log('    source chain head          : unreachable via configured RPC');
    }
  }

  console.log('\n=== Creditcoin node ===');
  const net = await provider.getNetwork();
  console.log(`  chainId: ${net.chainId}  (spec says 102031)`);
  console.log(`  head:    ${await provider.getBlockNumber()}`);
}

main().catch((e) => {
  console.error('FAILED:', e.message ?? e);
  process.exit(1);
});
