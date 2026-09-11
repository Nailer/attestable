import { useState } from 'react';
import type { Cover } from '../lib/chain';
import { fmtTime } from '../lib/chain';
import { submitEvidence, type SubmitProgress } from '../lib/prover';
import { CONFIG } from '../lib/config';
import type { WalletState } from '../lib/wallet';

/**
 * Runs the proof worker in the browser.
 *
 * This is what removes the terminal from the user's path: discovering updates,
 * fetching proofs, and submitting them all happen here, signed by the user's own
 * wallet. Each submission is a separate signature, because each is a separate
 * on-chain transaction — that is honest rather than convenient.
 */
export function SubmitEvidencePanel({
  cover,
  wallet,
  onDone,
}: {
  cover: Cover;
  wallet: WalletState | null;
  onDone: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [summary, setSummary] = useState<string | null>(null);

  const canRun = wallet?.onCorrectChain && cover.status === 'ACTIVE';

  function push(line: string) {
    setLog((l) => [...l.slice(-40), line]);
  }

  function describe(p: SubmitProgress): string {
    const when = p.candidate.updatedAt ? fmtTime(p.candidate.updatedAt).slice(11, 19) : '';
    switch (p.stage) {
      case 'proving':
        return p.candidate.txHash
          ? `[${p.index + 1}/${p.total}] ${when} — ${p.detail}`
          : `${p.detail}`;
      case 'signing':
        return `[${p.index + 1}/${p.total}] ${when} — ${p.detail}`;
      case 'confirmed':
        return `[${p.index + 1}/${p.total}] ${when} — verified on Creditcoin ✓  ${p.txHash?.slice(0, 10)}…`;
      case 'skipped':
        return `[${p.index + 1}/${p.total}] ${when} — skipped: ${p.detail}`;
      case 'failed':
        return `[${p.index + 1}/${p.total}] ${when} — failed: ${p.detail}`;
    }
  }

  async function run() {
    setRunning(true);
    setSummary(null);
    setLog([]);
    try {
      const r = await submitEvidence(cover.id, cover.policy, cover.lastTimestamp, (p) => push(describe(p)));
      setSummary(
        `${r.submitted} submitted · ${r.skipped} already recorded · ${r.failed} failed`
      );
      onDone();
    } catch (e: any) {
      push(`error: ${e?.shortMessage ?? e?.message ?? String(e)}`);
    } finally {
      setRunning(false);
    }
  }

  if (cover.status !== 'ACTIVE') return null;

  return (
    <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
      <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Submit evidence</h3>
      <p className="footnote" style={{ marginTop: 0 }}>
        Fetches every qualifying Chainlink update inside this window, obtains an Attestcoin proof for
        each, and submits it for on-chain verification. Your wallet signs each submission.{' '}
        <b>Anyone can do this</b> — the underwriter is simply the party most motivated to, since
        missing evidence pushes the outcome toward a claim.
      </p>

      <button className="btn primary" disabled={!canRun || running} onClick={run}>
        {running ? 'Working — approve each transaction…' : 'Fetch and submit evidence'}
      </button>

      {!wallet && <span className="footnote" style={{ marginLeft: 10 }}>Connect a wallet first.</span>}
      {wallet && !wallet.onCorrectChain && (
        <span className="footnote" style={{ marginLeft: 10 }}>Switch to Creditcoin first.</span>
      )}

      {log.length > 0 && (
        <pre
          style={{
            marginTop: 12,
            background: 'var(--bg)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 12,
            fontSize: 12,
            maxHeight: 260,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            color: 'var(--muted)',
          }}
        >
          {log.join('\n')}
        </pre>
      )}

      {summary && (
        <p className="footnote" style={{ color: 'var(--green)' }}>
          {summary} ·{' '}
          <a href={`${CONFIG.explorers.creditcoin}/address/${CONFIG.ascAddress}`} target="_blank" rel="noreferrer">
            view on explorer ↗
          </a>
        </p>
      )}
    </div>
  );
}
