import type { Cover, Evidence } from '../lib/chain';
import { CONFIG } from '../lib/config';
import { fmtMins, fmtPrice, fmtTime, short } from '../lib/chain';
import { useSettings } from '../lib/settings';

/**
 * The Evidence Explorer.
 *
 * Its job is to let a sceptic verify every claim independently. Each step links
 * to a real block explorer — the source event on Ethereum, the verification on
 * Creditcoin, the attestation dashboard. Nothing has to be taken on our word.
 */
export function EvidenceChain({ e, policy }: { e: Evidence; policy: Cover['policy'] }) {
  const steps = [
    {
      n: '1',
      label: 'Source event on Ethereum',
      detail: (
        <>
          Chainlink aggregator published{' '}
          <b>{fmtPrice(e.price)}</b>
          {e.roundId !== undefined && <> at round {e.roundId.toString()}</>} ·{' '}
          {fmtTime(e.updatedAt)}
          {e.sourceBlock && (
            <>
              {' '}
              ·{' '}
              <a
                href={`${CONFIG.explorers.sepolia}/block/${e.sourceBlock}`}
                target="_blank"
                rel="noreferrer"
              >
                block {e.sourceBlock.toLocaleString()} ↗
              </a>
            </>
          )}
        </>
      ),
    },
    {
      n: '2',
      label: 'Attestcoin proof generated',
      detail: (
        <>
          Merkle inclusion + continuity to an attested block. Only possible once the frontier
          passed source block {e.sourceBlock?.toLocaleString() ?? '—'}.
        </>
      ),
    },
    {
      n: '3',
      label: 'Verified on Creditcoin',
      detail: (
        <>
          Block Prover precompile{' '}
          <code>{CONFIG.blockProverPrecompile.slice(0, 6)}…0FD2</code> confirmed inclusion; the
          contract then checked receipt status, emitter, and event shape ·{' '}
          <a
            href={`${CONFIG.explorers.creditcoin}/tx/${e.creditcoinTx}`}
            target="_blank"
            rel="noreferrer"
          >
            {short(e.creditcoinTx)} ↗
          </a>
        </>
      ),
    },
    {
      n: '4',
      label: 'Recorded against policy',
      detail: (
        <>
          Gap from previous update: <b>{fmtMins(e.gap)}</b> · running worst gap after this
          evidence: <b>{fmtMins(e.maxGapAfter)}</b> (tolerance {fmtMins(policy.toleranceSecs)})
        </>
      ),
    },
  ];

  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className="badge verified">VERIFIED</span>
        <span className="mono" style={{ color: 'var(--muted)', fontSize: 12 }}>
          queryId {short(e.queryId, 8)}
        </span>
      </div>
      {steps.map((s) => (
        <div className="chain-step" key={s.n}>
          <div className="chain-icon">{s.n}</div>
          <div className="chain-body">
            <div className="chain-label">{s.label}</div>
            <div className="chain-detail">{s.detail}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EvidenceExplorer({
  cover,
  evidence,
  provisional,
}: {
  cover: Cover;
  evidence: Evidence[];
  provisional: number[];
}) {
  const [settings] = useSettings();
  const shown = settings.showProvisional ? provisional : [];
  return (
    <div className="panel">
      <h2>Evidence Explorer — Cover #{cover.id}</h2>
      <p className="sub">
        Every hop links to a public explorer. Verify any of it independently.
      </p>

      {evidence.length === 0 && shown.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>
          No evidence recorded. If the window has closed, the entire window counts as one unbroken
          silence — which is exactly why this cover would settle as a claim.
        </p>
      )}

      {evidence.map((e) => (
        <EvidenceChain key={e.queryId + e.creditcoinTx} e={e} policy={cover.policy} />
      ))}

      {shown.length > 0 && (
        <>
          <h3 style={{ fontSize: 13, marginTop: 24, marginBottom: 6 }}>
            Observed off-chain, not yet verified
          </h3>
          <p className="footnote" style={{ marginTop: 0 }}>
            These updates were seen directly on Ethereum but have no Creditcoin proof yet.{' '}
            <b>They are not settlement input.</b> Only verified evidence decides an outcome — this
            distinction is deliberate and never blended.
          </p>
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Observed at</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((ts) => (
                <tr key={ts} className="provisional-row">
                  <td>
                    <span className="badge provisional">PROVISIONAL</span>
                  </td>
                  <td className="num">{fmtTime(ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
