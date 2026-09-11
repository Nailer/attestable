import { useState } from 'react';
import type { Cover, Evidence, Settlement } from '../lib/chain';
import { CONFIG } from '../lib/config';
import { fmtCtc, fmtMins, fmtTime, short } from '../lib/chain';

/** Policy Transparency — every term, stated plainly, marked immutable. */
function PolicyTerms({ cover, premium, collateral }: { cover: Cover; premium: bigint; collateral: bigint }) {
  const p = cover.policy;
  return (
    <>
      <h3 style={{ fontSize: 13, margin: '18px 0 8px' }}>Policy terms</h3>
      <table>
        <tbody>
          <tr>
            <td style={{ color: 'var(--dim)', width: 190 }}>Covered condition</td>
            <td>
              No silence between updates may exceed <b>{fmtMins(p.toleranceSecs)}</b>
            </td>
          </tr>
          <tr>
            <td style={{ color: 'var(--dim)' }}>Source chain</td>
            <td>Ethereum Sepolia · Attestcoin chainKey {p.chainKey}</td>
          </tr>
          <tr>
            <td style={{ color: 'var(--dim)' }}>Monitored contract</td>
            <td>
              <a href={`${CONFIG.explorers.sepolia}/address/${p.sourceContract}#events`} target="_blank" rel="noreferrer">
                {short(p.sourceContract, 10)} ↗
              </a>
              <div className="footnote" style={{ marginTop: 2 }}>
                The aggregator, not the proxy — the proxy forwards calls but emits no events.
              </div>
            </td>
          </tr>
          <tr>
            <td style={{ color: 'var(--dim)' }}>Evidence event</td>
            <td className="mono" style={{ fontSize: 12 }}>
              AnswerUpdated · {short(p.eventSignature, 10)}
            </td>
          </tr>
          <tr>
            <td style={{ color: 'var(--dim)' }}>Coverage window</td>
            <td className="num">
              {fmtTime(p.windowStart)}
              <br />
              {fmtTime(p.windowEnd)}
              <div className="footnote" style={{ marginTop: 2 }}>
                {((p.windowEnd - p.windowStart) / 3600).toFixed(1)} hours
              </div>
            </td>
          </tr>
          <tr>
            <td style={{ color: 'var(--dim)' }}>Premium</td>
            <td>{fmtCtc(premium)} — paid by the buyer</td>
          </tr>
          <tr>
            <td style={{ color: 'var(--dim)' }}>Collateral</td>
            <td>{fmtCtc(collateral)} — posted by the underwriter, maximum payout</td>
          </tr>
        </tbody>
      </table>
      <p className="footnote">
        <b>These terms cannot be changed once the cover is active.</b> A buyer can read every one of
        them before paying, which is the defence against a misconfigured policy — no runtime check
        can catch a wrong event signature, because two real Chainlink events share the same shape.
      </p>
    </>
  );
}

function SettlementResult({ s, cover }: { s: Settlement; cover: Cover }) {
  const claimed = s.outcome === 'CLAIMED';
  return (
    <>
      <h3 style={{ fontSize: 13, margin: '18px 0 8px' }}>Settlement</h3>
      <div className="grid three">
        <div className="stat">
          <div className="label">Worst silence measured</div>
          <div className="value" style={{ color: claimed ? 'var(--amber)' : 'var(--green)' }}>
            {fmtMins(s.maxGap)}
          </div>
          <div className="note">tolerance {fmtMins(s.toleranceSecs)}</div>
        </div>
        <div className="stat">
          <div className="label">To buyer</div>
          <div className="value">{fmtCtc(s.toBuyer)}</div>
          <div className="note">{claimed ? 'claim paid from collateral' : 'no claim — nothing owed'}</div>
        </div>
        <div className="stat">
          <div className="label">To underwriter</div>
          <div className="value">{fmtCtc(s.toUnderwriter)}</div>
          <div className="note">{claimed ? 'keeps the premium' : 'collateral returned + premium earned'}</div>
        </div>
      </div>
      <p className="footnote">
        Settled automatically ·{' '}
        <a href={`${CONFIG.explorers.creditcoin}/tx/${s.tx}`} target="_blank" rel="noreferrer">
          {short(s.tx)} ↗
        </a>{' '}
        · No claim was filed, no assessor voted, no administrator approved.
      </p>
    </>
  );
}

export function CoverCard({
  cover,
  evidence,
  settlement,
  onSelect,
  selected,
}: {
  cover: Cover;
  evidence: Evidence[];
  settlement: Settlement | null;
  onSelect: () => void;
  selected: boolean;
}) {
  const [open, setOpen] = useState(selected);
  const gap = settlement ? settlement.maxGap : cover.projectedMaxGap;
  // settle() zeroes collateral and premium in storage, so always use the terms
  // recorded at creation — they are what both parties actually agreed to.
  const premium = cover.originalPremium;
  const collateral = cover.originalCollateral;
  const pct = Math.min(100, (gap / cover.policy.toleranceSecs) * 100);
  const over = gap > cover.policy.toleranceSecs;

  return (
    <div className={`cover ${cover.status}`}>
      <div
        className="cover-head"
        onClick={() => {
          setOpen(!open);
          onSelect();
        }}
      >
        <div>
          <div className="cover-title">
            Cover #{cover.id} · Chainlink ETH/USD liveness
          </div>
          <div className="cover-sub">
            {fmtTime(cover.policy.windowStart).slice(0, 16)} → {fmtTime(cover.policy.windowEnd).slice(0, 16)} ·{' '}
            {cover.evidenceCount} verified {cover.evidenceCount === 1 ? 'proof' : 'proofs'}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className={`status ${cover.status}`}>{cover.status}</span>
          <div className="cover-sub" style={{ marginTop: 4 }}>
            {fmtCtc(collateral)} {settlement ? 'settled' : 'at risk'}
          </div>
        </div>
      </div>

      {open && (
        <div className="cover-body">
          <h3 style={{ fontSize: 13, margin: '18px 0 8px' }}>
            Worst silence vs tolerance
          </h3>
          <div className="bar">
            <div className={`bar-fill ${over ? 'over' : 'ok'}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="bar-legend">
            <span>{fmtMins(gap)} observed</span>
            <span>{fmtMins(cover.policy.toleranceSecs)} allowed</span>
          </div>
          <p className="footnote">
            {over
              ? 'The silence exceeded what the policy permits, so the collateral goes to the buyer.'
              : 'Every gap stayed inside tolerance, so the underwriter keeps the collateral and earns the premium.'}
          </p>

          <div className="grid two" style={{ marginTop: 16 }}>
            <div className="stat">
              <div className="label">Buyer</div>
              <div className="value" style={{ fontSize: 13 }}>{short(cover.buyer, 8)}</div>
              <div className="note">paid {fmtCtc(premium)}</div>
            </div>
            <div className="stat">
              <div className="label">Underwriter</div>
              <div className="value" style={{ fontSize: 13 }}>{short(cover.underwriter, 8)}</div>
              <div className="note">posted {fmtCtc(collateral)}</div>
            </div>
          </div>

          {settlement && <SettlementResult s={settlement} cover={cover} />}
          <PolicyTerms cover={cover} premium={premium} collateral={collateral} />
        </div>
      )}
    </div>
  );
}
