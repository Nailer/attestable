// RPC access layer.
//
// No single free Sepolia endpoint does both jobs we need:
//   - WIDE scanning over thousands of blocks, but only recent history
//     (public endpoints: generous ranges, ~10k blocks of retention)
//   - ARCHIVE lookups deep into history, but tiny ranges
//     (Alchemy free tier: full archive, 10-block getLogs cap)
//
// So we use both, and pick per task. Discovered the hard way when the outage
// window silently returned zero logs on a public endpoint.
import 'dotenv/config';
import { ethers } from 'ethers';

// Pin the network explicitly. Auto-detection costs a round trip on every
// provider construction and was timing out against the archive endpoint.
const SEPOLIA = new ethers.Network('sepolia', 11155111);
const opts = { staticNetwork: SEPOLIA };

export const scanProvider = () =>
  new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_SCAN_RPC ?? process.env.SOURCE_CHAIN_RPC_URL!, SEPOLIA, opts);

export const archiveProvider = () =>
  new ethers.JsonRpcProvider(process.env.SOURCE_CHAIN_ARCHIVE_RPC ?? process.env.SOURCE_CHAIN_RPC_URL!, SEPOLIA, opts);

/**
 * getLogs with automatic range chunking and cap detection.
 *
 * If a provider rejects the range, its error message usually names the maximum
 * it will accept — we parse that and retry rather than guessing.
 */
export async function getLogsChunked(
  provider: ethers.JsonRpcProvider,
  filter: { address: string; topics: (string | null)[] },
  fromBlock: number,
  toBlock: number,
  opts: { chunk?: number; quiet?: boolean } = {}
): Promise<ethers.Log[]> {
  let chunk = opts.chunk ?? 2000;
  const out: ethers.Log[] = [];

  for (let start = fromBlock; start <= toBlock; ) {
    const end = Math.min(start + chunk - 1, toBlock);
    try {
      const logs = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
      out.push(...logs);
      start = end + 1;
    } catch (e: any) {
      const msg = String(e?.info?.responseBody ?? e?.message ?? '');
      const cap = msg.match(/up to a (\d+) block range/);
      if (cap && chunk > Number(cap[1])) {
        chunk = Number(cap[1]);
        if (!opts.quiet) console.log(`      (provider caps ranges at ${chunk} blocks — adjusting)`);
        continue; // retry the same start with the smaller chunk
      }
      if (chunk > 10) {
        chunk = Math.max(10, Math.floor(chunk / 4));
        continue;
      }
      throw e;
    }
  }
  return out;
}

/** Fetch logs at a handful of exactly-known blocks. Cheap even under a 10-block cap. */
export async function getLogsAtBlocks(
  provider: ethers.JsonRpcProvider,
  filter: { address: string; topics: (string | null)[] },
  blocks: number[]
): Promise<ethers.Log[]> {
  const out: ethers.Log[] = [];
  for (const b of blocks) {
    const logs = await provider.getLogs({ ...filter, fromBlock: b, toBlock: b });
    out.push(...logs);
  }
  return out;
}
