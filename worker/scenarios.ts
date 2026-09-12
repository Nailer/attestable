// Derives real coverage windows from actual on-chain history.
//
// Both demo scenarios use the SAME real Chainlink feed and the SAME pipeline.
// The only difference is which stretch of genuine history the window covers.
// No evidence is manufactured, no service is taken down.
import 'dotenv/config';
import { ethers } from 'ethers';
import { getLogsChunked, getLogsAtBlocks, archiveProvider } from './rpc';

export const ANSWER_UPDATED = ethers.id('AnswerUpdated(int256,uint256,uint256)');

export interface Scenario {
  name: string;
  expect: 'HEALTHY' | 'CLAIMED';
  windowStart: number;
  windowEnd: number;
  windowStartBlock: number;
  windowEndBlock: number;
  toleranceSecs: number;
  note: string;
}

/// 90 minutes. Never 60 — spike 1.5 measured a 61.4-minute worst-case gap on a
/// perfectly healthy feed, so the nominal 3600s heartbeat is an unsafe tolerance.
export const TOLERANCE_SECS = 5400;

export async function blockTime(p: ethers.JsonRpcProvider, block: number): Promise<number> {
  const b = await p.getBlock(block);
  if (!b) throw new Error(`block ${block} not found`);
  return b.timestamp;
}

/// The genuine 2026-08-31 outage: 773.6 minutes of silence between two real
/// updates, verified in spike 1.6 with error suppression removed and blocks
/// confirmed to be producing throughout.
export async function outageScenario(_p: ethers.JsonRpcProvider): Promise<Scenario> {
  const startBlock = 11_602_342;
  const endBlock = 11_605_987;
  // These blocks are far enough back that public endpoints no longer serve
  // them. The archive endpoint does, and because we know the exact heights we
  // only need single-block queries — well inside its 10-block range cap.
  const p = archiveProvider();
  return {
    name: 'outage',
    expect: 'CLAIMED',
    windowStart: await blockTime(p, startBlock),
    windowEnd: await blockTime(p, endBlock),
    windowStartBlock: startBlock,
    windowEndBlock: endBlock,
    toleranceSecs: TOLERANCE_SECS,
    note: 'Real 12.9-hour lapse on Sepolia ETH/USD, 2026-08-31.',
  };
}

/// A stretch where the feed behaved normally. Found by scanning rather than
/// assumed, so the HEALTHY outcome is also earned from real data.
export async function healthyScenario(
  p: ethers.JsonRpcProvider,
  aggregator: string,
  attestedHead: number
): Promise<Scenario> {
  // Search recent attested history for a run of updates with no gap over tolerance.
  const to = attestedHead - 50;
  const from = to - 2000;
  const logs = await getLogsChunked(p, { address: aggregator, topics: [ANSWER_UPDATED] }, from, to, { quiet: true });
  if (logs.length < 3) throw new Error('not enough recent updates to build a healthy window');

  const stamps: { block: number; ts: number }[] = [];
  for (const l of logs) stamps.push({ block: l.blockNumber, ts: await blockTime(p, l.blockNumber) });
  stamps.sort((a, b) => a.ts - b.ts);

  // Walk backwards for the longest run whose internal gaps all fit the tolerance.
  let endIdx = stamps.length - 1;
  let startIdx = endIdx;
  while (startIdx > 0 && stamps[startIdx].ts - stamps[startIdx - 1].ts <= TOLERANCE_SECS) startIdx--;

  if (endIdx - startIdx < 1) throw new Error('no compliant run found in the scanned range');

  return {
    name: 'healthy',
    expect: 'HEALTHY',
    windowStart: stamps[startIdx].ts,
    windowEnd: stamps[endIdx].ts,
    windowStartBlock: stamps[startIdx].block,
    windowEndBlock: stamps[endIdx].block,
    toleranceSecs: TOLERANCE_SECS,
    note: `Steady period, ${endIdx - startIdx + 1} updates, all gaps within tolerance.`,
  };
}
