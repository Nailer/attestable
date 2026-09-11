// In-browser proof worker.
//
// Previously this only existed as a Node CLI, which meant a real user could not
// complete the flow without a terminal and a private key in a file. The Proof
// Builder serves `access-control-allow-origin: *`, so the whole pipeline —
// discover events, wait for attestation, fetch proofs, submit them — runs in the
// page, with the user signing each submission from their own wallet.
//
// The browser worker is still only a COURIER. It cannot fabricate evidence (the
// proof would fail on-chain verification) and it cannot suppress evidence
// (submission is permissionless — anyone else can submit the same proof).
import { ethers } from 'ethers';
import { CONFIG } from './config';
import ascAbi from './asc.abi.json';
import type { Policy } from './chain';

export interface ProofResponse {
  chainKey: number;
  headerNumber: number;
  txIndex: number;
  txHash: string;
  txBytes: string;
  merkleProof: { root: string; siblings: { hash: string; isLeft: boolean }[] };
  continuityProof: { lowerEndpointDigest: string; roots: string[] };
}

export interface Candidate {
  txHash: string;
  block: number;
  updatedAt: number;
}

/** How far the attestation frontier has advanced for a source chain. */
export async function attestedHeight(chainKey: number): Promise<number> {
  const r = await fetch(`${CONFIG.proofBuilderUrl}/api/v1/attested-height/${chainKey}`);
  if (!r.ok) throw new Error(`attested-height failed: ${r.status}`);
  return (await r.json()).attestedHeight;
}

export async function fetchProof(txHash: string, chainKey: number): Promise<ProofResponse> {
  // chainKey is a PATH segment, not a query parameter. Getting this wrong
  // returns a 404 with an empty body, which is easy to misread as "no proof
  // exists" rather than "wrong URL".
  const r = await fetch(`${CONFIG.proofBuilderUrl}/api/v1/proof-by-tx/${chainKey}/${txHash}`);
  if (!r.ok) throw new Error(`proof request failed: ${r.status} ${await r.text()}`);
  const body = await r.json();
  return (body.data ?? body) as ProofResponse;
}

/**
 * Find qualifying updates inside a policy's window.
 *
 * Public Sepolia endpoints allow wide block ranges but only retain recent
 * history; archive endpoints reach further but cap ranges hard. We scan in
 * chunks and shrink automatically when a provider objects, which covers both.
 */
export async function findCandidates(
  policy: Policy,
  onProgress?: (msg: string) => void
): Promise<Candidate[]> {
  const provider = new ethers.JsonRpcProvider(CONFIG.sepoliaRpc);
  const end = policy.windowEndBlock;
  const start = Math.max(0, end - 6000);

  let chunk = 2000;
  const logs: ethers.Log[] = [];

  for (let from = start; from <= end; ) {
    const to = Math.min(from + chunk - 1, end);
    try {
      const got = await provider.getLogs({
        address: policy.sourceContract,
        topics: [policy.eventSignature],
        fromBlock: from,
        toBlock: to,
      });
      logs.push(...got);
      from = to + 1;
      onProgress?.(`scanned to block ${to.toLocaleString()} — ${logs.length} updates found`);
    } catch (e: any) {
      const cap = String(e?.message ?? '').match(/up to a (\d+) block range/);
      if (cap && chunk > Number(cap[1])) {
        chunk = Number(cap[1]);
        continue;
      }
      if (chunk > 10) {
        chunk = Math.max(10, Math.floor(chunk / 4));
        continue;
      }
      throw e;
    }
  }

  return logs
    .map((l) => ({
      txHash: l.transactionHash,
      block: l.blockNumber,
      updatedAt: Number(BigInt(l.data)),
    }))
    .filter((c) => c.updatedAt >= policy.windowStart && c.updatedAt <= policy.windowEnd)
    .sort((a, b) => a.updatedAt - b.updatedAt);
}

/**
 * Gas for one submission.
 *
 * The reference formula models only the precompile call. Measured cost is
 * dominated by a large fixed component — decoding a ~3kB receipt, searching its
 * logs, calling into the vault — so a floor matters more than the per-root term.
 * Two submissions previously ran out of gas without it.
 */
function gasFor(rootCount: number): bigint {
  return BigInt(Math.max(600_000, 200_000 + rootCount * 6_000) + 200_000);
}

export interface SubmitProgress {
  index: number;
  total: number;
  stage: 'proving' | 'signing' | 'confirmed' | 'skipped' | 'failed';
  candidate: Candidate;
  detail?: string;
  txHash?: string;
}

/**
 * Submit every qualifying update that is not already recorded.
 *
 * Evidence must go in chronological order — the contract evaluates max-interval
 * incrementally and rejects anything out of sequence. Anything at or before
 * `lastTimestamp` is already in, so it is skipped rather than burned on a
 * guaranteed revert.
 */
export async function submitEvidence(
  coverId: number,
  policy: Policy,
  lastTimestamp: number,
  onProgress: (p: SubmitProgress) => void
): Promise<{ submitted: number; skipped: number; failed: number }> {
  const candidates = await findCandidates(policy, (m) =>
    onProgress({ index: 0, total: 0, stage: 'proving', candidate: { txHash: '', block: 0, updatedAt: 0 }, detail: m })
  );

  const pending = lastTimestamp === 0 ? candidates : candidates.filter((c) => c.updatedAt > lastTimestamp);
  const skipped = candidates.length - pending.length;

  const browserProvider = new ethers.BrowserProvider((window as any).ethereum);
  const signer = await browserProvider.getSigner();
  const asc = new ethers.Contract(CONFIG.ascAddress, ascAbi, signer);

  const frontier = await attestedHeight(policy.chainKey);

  let submitted = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i++) {
    const c = pending[i];

    if (c.block > frontier) {
      onProgress({
        index: i, total: pending.length, stage: 'skipped', candidate: c,
        detail: `block ${c.block.toLocaleString()} is ahead of the attestation frontier (${frontier.toLocaleString()}) — not provable yet`,
      });
      continue;
    }

    try {
      onProgress({ index: i, total: pending.length, stage: 'proving', candidate: c, detail: 'requesting proof' });
      const p = await fetchProof(c.txHash, policy.chainKey);

      onProgress({
        index: i, total: pending.length, stage: 'signing', candidate: c,
        detail: `${p.continuityProof.roots.length} continuity roots — approve in your wallet`,
      });

      const tx = await asc.submitEvidence(
        coverId,
        {
          chainKey: p.chainKey,
          blockHeight: p.headerNumber,
          encodedTransaction: p.txBytes,
          merkleRoot: p.merkleProof.root,
          siblings: p.merkleProof.siblings,
          lowerEndpointDigest: p.continuityProof.lowerEndpointDigest,
          continuityRoots: p.continuityProof.roots,
        },
        { gasLimit: gasFor(p.continuityProof.roots.length) }
      );
      await tx.wait();
      submitted++;
      onProgress({ index: i, total: pending.length, stage: 'confirmed', candidate: c, txHash: tx.hash });
    } catch (e: any) {
      failed++;
      onProgress({
        index: i, total: pending.length, stage: 'failed', candidate: c,
        detail: e?.shortMessage ?? e?.message ?? String(e),
      });
    }
  }

  return { submitted, skipped, failed };
}
