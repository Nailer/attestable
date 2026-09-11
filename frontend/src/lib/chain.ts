// All on-chain reads. The frontend is a VIEWER — it never computes a settlement
// outcome itself, never derives a number the contract could have told it, and
// never presents off-chain observation as though it were verified.
import { ethers } from 'ethers';
import { CONFIG } from './config';
import coverAbi from './cover.abi.json';
import ascAbi from './asc.abi.json';

export const cc = new ethers.JsonRpcProvider(CONFIG.creditcoinRpc);
export const sepolia = new ethers.JsonRpcProvider(CONFIG.sepoliaRpc);

export const coverContract = new ethers.Contract(CONFIG.coverAddress, coverAbi, cc);
export const ascContract = new ethers.Contract(CONFIG.ascAddress, ascAbi, cc);

export const STATUS = ['OPEN', 'ACTIVE', 'HEALTHY', 'CLAIMED', 'CANCELLED'] as const;
export type Status = (typeof STATUS)[number];

export interface Policy {
  chainKey: number;
  sourceContract: string;
  eventSignature: string;
  windowStart: number;
  windowEnd: number;
  windowEndBlock: number;
  toleranceSecs: number;
}

export interface Cover {
  id: number;
  buyer: string;
  underwriter: string;
  premium: bigint;
  collateral: bigint;
  policy: Policy;
  status: Status;
  lastTimestamp: number;
  maxGap: number;
  evidenceCount: number;
  projectedMaxGap: number;
  /** Agreed at creation. Survives settlement, unlike the storage fields. */
  originalCollateral: bigint;
  originalPremium: bigint;
}

/** One verified piece of evidence, as recorded on Creditcoin. */
export interface Evidence {
  coverId: number;
  queryId: string;
  updatedAt: number;
  gap: number;
  maxGapAfter: number;
  price: bigint;
  creditcoinTx: string;
  creditcoinBlock: number;
  /** Source-chain provenance, from the ASC's own event. */
  sourceBlock?: number;
  roundId?: bigint;
}

/** Collateral + premium are zeroed on settlement, so post-settlement the real
 *  figures must be recovered from the settlement event itself. */
export interface Settlement {
  coverId: number;
  outcome: Status;
  maxGap: number;
  toleranceSecs: number;
  toBuyer: bigint;
  toUnderwriter: bigint;
  tx: string;
  block: number;
}

/**
 * Original terms, read from the CoverCreated event.
 *
 * settle() zeroes `collateral` and `premium` in storage once funds are paid out,
 * so after settlement those fields read 0. The creation event is the only place
 * the agreed figures survive — and it is also the honest source, since it is
 * what both parties actually signed up to.
 */
export async function getOriginalTerms(
  coverId: number
): Promise<{ collateral: bigint; premium: bigint } | null> {
  const logs = await coverContract.queryFilter(
    coverContract.filters.CoverCreated(coverId),
    CONFIG.deployBlock,
    'latest'
  );
  if (logs.length === 0) return null;
  const ev = logs[0] as ethers.EventLog;
  return { collateral: ev.args[2] as bigint, premium: ev.args[3] as bigint };
}

export async function getCoverCount(): Promise<number> {
  return Number(await coverContract.nextCoverId()) - 1;
}

export async function getCover(id: number): Promise<Cover> {
  const [c, projected, original] = await Promise.all([
    coverContract.getCover(id),
    coverContract.projectedMaxGap(id),
    getOriginalTerms(id),
  ]);
  return {
    id,
    buyer: c.buyer,
    underwriter: c.underwriter,
    premium: c.premium,
    collateral: c.collateral,
    policy: {
      chainKey: Number(c.policy.chainKey),
      sourceContract: c.policy.sourceContract,
      eventSignature: c.policy.eventSignature,
      windowStart: Number(c.policy.windowStart),
      windowEnd: Number(c.policy.windowEnd),
      windowEndBlock: Number(c.policy.windowEndBlock),
      toleranceSecs: Number(c.policy.toleranceSecs),
    },
    status: STATUS[Number(c.status)],
    lastTimestamp: Number(c.lastTimestamp),
    maxGap: Number(c.maxGap),
    evidenceCount: Number(c.evidenceCount),
    projectedMaxGap: Number(projected),
    originalCollateral: original?.collateral ?? c.collateral,
    originalPremium: original?.premium ?? c.premium,
  };
}

export async function getAllCovers(): Promise<Cover[]> {
  const n = await getCoverCount();
  const ids = Array.from({ length: n }, (_, i) => i + 1);
  return Promise.all(ids.map(getCover));
}

/**
 * Verified evidence for a cover, read from the CONTRACT'S OWN EVENTS.
 * Joined with the ASC's EvidenceVerified event to recover source-chain
 * provenance — which block on Ethereum each piece of evidence came from.
 */
export async function getEvidence(coverId: number): Promise<Evidence[]> {
  const [recorded, verified] = await Promise.all([
    coverContract.queryFilter(coverContract.filters.EvidenceRecorded(coverId), CONFIG.deployBlock, 'latest'),
    ascContract.queryFilter(ascContract.filters.EvidenceVerified(coverId), CONFIG.deployBlock, 'latest'),
  ]);

  const provenance = new Map<string, { sourceBlock: number; roundId: bigint }>();
  for (const v of verified) {
    const ev = v as ethers.EventLog;
    provenance.set(String(ev.args[1]).toLowerCase(), {
      sourceBlock: Number(ev.args[2]),
      roundId: ev.args[5] as bigint,
    });
  }

  return recorded.map((log) => {
    const ev = log as ethers.EventLog;
    const queryId = String(ev.args[1]);
    const p = provenance.get(queryId.toLowerCase());
    return {
      coverId,
      queryId,
      updatedAt: Number(ev.args[2]),
      gap: Number(ev.args[3]),
      maxGapAfter: Number(ev.args[4]),
      price: ev.args[5] as bigint,
      creditcoinTx: ev.transactionHash,
      creditcoinBlock: ev.blockNumber,
      sourceBlock: p?.sourceBlock,
      roundId: p?.roundId,
    };
  });
}

export async function getSettlement(coverId: number): Promise<Settlement | null> {
  const logs = await coverContract.queryFilter(coverContract.filters.CoverSettled(coverId), CONFIG.deployBlock, 'latest');
  if (logs.length === 0) return null;
  const ev = logs[logs.length - 1] as ethers.EventLog;
  return {
    coverId,
    outcome: STATUS[Number(ev.args[1])],
    maxGap: Number(ev.args[2]),
    toleranceSecs: Number(ev.args[3]),
    toBuyer: ev.args[4] as bigint,
    toUnderwriter: ev.args[5] as bigint,
    tx: ev.transactionHash,
    block: ev.blockNumber,
  };
}

/**
 * Live pipeline health. Every number here is read from a chain, never inferred.
 * The attestation frontier is what determines whether evidence CAN be proven —
 * so this panel is how you tell "no outage" apart from "we can't see yet".
 */
export interface ProofHealth {
  sepoliaHead: number;
  attestedHeight: number;
  lagBlocks: number;
  lagSeconds: number;
  creditcoinHead: number;
  escrowHeld: bigint;
  aggregatorLastPrice?: bigint;
  aggregatorLastUpdate?: number;
}

const CHAIN_INFO_ABI = [
  'function get_latest_attestation_height_and_hash(uint64 chainKey) view returns (tuple(uint64 height, bytes32 hash, bool isAttestation, bool exists))',
];

const AGGREGATOR_ABI = [
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
];

export async function getProofHealth(): Promise<ProofHealth> {
  const chainInfo = new ethers.Contract(CONFIG.chainInfoPrecompile, CHAIN_INFO_ABI, cc);
  const agg = new ethers.Contract(CONFIG.aggregator, AGGREGATOR_ABI, sepolia);

  const [sepoliaHead, creditcoinHead, attested, escrow] = await Promise.all([
    sepolia.getBlockNumber(),
    cc.getBlockNumber(),
    chainInfo.get_latest_attestation_height_and_hash(CONFIG.sepoliaChainKey),
    cc.getBalance(CONFIG.coverAddress),
  ]);

  let aggregatorLastPrice: bigint | undefined;
  let aggregatorLastUpdate: number | undefined;
  try {
    const r = await agg.latestRoundData();
    aggregatorLastPrice = r[1] as bigint;
    aggregatorLastUpdate = Number(r[3]);
  } catch {
    /* feed unreachable — surfaced as unknown rather than guessed */
  }

  const lagBlocks = sepoliaHead - Number(attested.height);
  return {
    sepoliaHead,
    creditcoinHead,
    attestedHeight: Number(attested.height),
    lagBlocks,
    lagSeconds: lagBlocks * 12,
    escrowHeld: escrow,
    aggregatorLastPrice,
    aggregatorLastUpdate,
  };
}

/**
 * PROVISIONAL observations — updates seen directly on Ethereum that have NOT
 * been verified on Creditcoin. These are shown distinctly and are never treated
 * as settlement input. Only Creditcoin-verified evidence decides an outcome.
 */
export async function getProvisional(policy: Policy, verified: Evidence[]): Promise<number[]> {
  const known = new Set(verified.map((e) => e.updatedAt));
  try {
    const logs = await sepolia.getLogs({
      address: policy.sourceContract,
      topics: [policy.eventSignature],
      fromBlock: policy.windowEndBlock - 1500,
      toBlock: policy.windowEndBlock,
    });
    return logs
      .map((l) => Number(BigInt(l.data)))
      .filter((ts) => ts >= policy.windowStart && ts <= policy.windowEnd && !known.has(ts))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

// --- formatting helpers -------------------------------------------------
export const fmtCtc = (v: bigint) => `${Number(ethers.formatEther(v)).toLocaleString()} CTC`;
export const fmtMins = (s: number) => `${(s / 60).toFixed(1)} min`;
export const fmtTime = (ts: number) => new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
export const fmtPrice = (p: bigint) => `$${(Number(p) / 1e8).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
export const short = (s: string, n = 6) => `${s.slice(0, n + 2)}…${s.slice(-4)}`;
