import { useState } from 'react';
import { ethers } from 'ethers';
import type { Cover } from '../lib/chain';
import { fmtCtc } from '../lib/chain';
import {
  connect,
  switchToCreditcoin,
  hasWallet,
  createCover,
  buyCover,
  cancelCover,
  settle,
  explainError,
  type WalletState,
  type NewCoverTerms,
} from '../lib/wallet';
import { CONFIG } from '../lib/config';

export function ConnectBar({
  wallet,
  onChange,
}: {
  wallet: WalletState | null;
  onChange: (w: WalletState | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!hasWallet()) {
    return (
      <div className="panel" style={{ marginBottom: 16 }}>
        <h2>No wallet detected</h2>
        <p className="sub" style={{ margin: 0 }}>
          Install <a href="https://metamask.io" target="_blank" rel="noreferrer">MetaMask</a>, then
          reload. You can browse everything below without one — a wallet is only needed to write
          covers, buy them, or trigger settlement.
        </p>
      </div>
    );
  }

  return (
    <div className="panel" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      {!wallet ? (
        <>
          <button
            className="btn primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                onChange(await connect());
              } catch (e) {
                setErr(explainError(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Connecting…' : 'Connect wallet'}
          </button>
          <span className="sub" style={{ margin: 0 }}>
            Needed to create, buy, or settle a cover.
          </span>
        </>
      ) : (
        <>
          <span className="chip">
            <b>{wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}</b>
          </span>
          {wallet.onCorrectChain ? (
            <span className="chip" style={{ color: 'var(--green)' }}>Creditcoin CC3 Testnet</span>
          ) : (
            <>
              <span className="chip" style={{ color: 'var(--amber)' }}>Wrong network</span>
              <button
                className="btn"
                onClick={async () => {
                  try {
                    await switchToCreditcoin();
                    onChange(await connect());
                  } catch (e) {
                    setErr(explainError(e));
                  }
                }}
              >
                Switch to Creditcoin
              </button>
            </>
          )}
        </>
      )}
      {err && <span style={{ color: 'var(--red)', fontSize: 13 }}>{err}</span>}
    </div>
  );
}

/** Kestrel's screen: open a cover and put collateral behind it. */
export function CreateCoverForm({ onDone }: { onDone: () => void }) {
  // Minutes, not hours. The previous 24-hour default meant a cover could not be
  // settled for a day — which made the app impossible to actually try. And the
  // lead time is now explicit, because a fixed 15 minutes silently made covers
  // unbuyable if you did not act fast enough.
  const [minutes, setMinutes] = useState('20');
  const [leadMinutes, setLeadMinutes] = useState('10');
  const [tolerance, setTolerance] = useState('90');
  const [collateral, setCollateral] = useState('200');
  const [premium, setPremium] = useState('12');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      // The window must open in the FUTURE — coverage cannot be bought once
      // its outcome is observable, so a buyer needs time to take it.
      //
      // The end block is deliberately OVER-estimated. Ethereum slots are 12s
      // and cannot be faster, so duration/12 is the maximum blocks a window can
      // span; the contract enforces at least that. Overshooting only delays
      // settlement slightly, whereas undershooting would let the attestation
      // gate pass before the window's final blocks were provable. The earlier
      // version of this form used a bare duration/12 estimate from the CURRENT
      // head, which could land short once the delayed start was accounted for.
      const sepolia = new ethers.JsonRpcProvider(CONFIG.sepoliaRpc);
      const head = await sepolia.getBlockNumber();
      const now = Math.floor(Date.now() / 1000);
      const leadSecs = Math.round(Number(leadMinutes) * 60);
      const durationSecs = Math.round(Number(minutes) * 60);
      const startBlock = head + Math.floor(leadSecs / 12);
      const terms: NewCoverTerms = {
        windowStart: now + leadSecs,
        windowEnd: now + leadSecs + durationSecs,
        windowStartBlock: startBlock,
        windowEndBlock: startBlock + Math.ceil(durationSecs / 12) + 50, // + margin
        toleranceSecs: Math.round(Number(tolerance) * 60),
        collateralCtc: collateral,
        premiumCtc: premium,
      };
      const { hash, coverId } = await createCover(terms);
      setMsg(`Cover #${coverId} created. Transaction ${hash.slice(0, 10)}…`);
      onDone();
    } catch (e) {
      setErr(explainError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Write a cover</h2>
      <p className="sub">
        You are the underwriter. You post collateral and set the terms; whoever buys it pays you the
        premium. If the feed keeps its heartbeat you keep everything. If it goes quiet beyond your
        tolerance, the buyer takes your collateral.
      </p>

      <div className="grid two">
        <label className="field">
          <span>Coverage duration (minutes)</span>
          <input value={minutes} onChange={(e) => setMinutes(e.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          <span>Buying window before coverage starts (minutes)</span>
          <input value={leadMinutes} onChange={(e) => setLeadMinutes(e.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          <span>Staleness tolerance (minutes)</span>
          <input value={tolerance} onChange={(e) => setTolerance(e.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          <span>Your collateral (tCTC) — the maximum you can lose</span>
          <input value={collateral} onChange={(e) => setCollateral(e.target.value)} inputMode="decimal" />
        </label>
        <label className="field">
          <span>Premium you charge (tCTC)</span>
          <input value={premium} onChange={(e) => setPremium(e.target.value)} inputMode="decimal" />
        </label>
      </div>

      {Number(tolerance) < 62 && (
        <p className="footnote" style={{ color: 'var(--amber)' }}>
          <b>Careful.</b> This feed's measured worst-case gap on a perfectly healthy day is{' '}
          <b>61.6 minutes</b>, even though its nominal heartbeat is 60. A tolerance below about 62
          minutes will pay claims against a functioning feed. 90 is the recommended setting.
        </p>
      )}

      <p className="footnote">
        <b>Timeline.</b> Coverage opens in {leadMinutes} min — it must be bought before then, since
        a cover whose outcome is already observable is no longer insurance. It closes{' '}
        {minutes} min later, and becomes settleable roughly 8 minutes after that, once Attestcoin
        has attested the source blocks covering the window's end.
        <br />
        Total time to a finished cycle: about{' '}
        <b>{Math.round(Number(leadMinutes) + Number(minutes) + 8)} minutes</b>.
      </p>

      <button className="btn primary" disabled={busy} onClick={submit} style={{ marginTop: 14 }}>
        {busy ? 'Confirm in your wallet…' : `Post ${collateral} tCTC and open the cover`}
      </button>

      {msg && <p className="footnote" style={{ color: 'var(--green)' }}>{msg}</p>}
      {err && <p className="footnote" style={{ color: 'var(--red)' }}>{err}</p>}
    </div>
  );
}

/** Buttons that appear on a cover depending on its state and who you are. */
export function CoverActions({
  cover,
  wallet,
  onDone,
}: {
  cover: Cover;
  wallet: WalletState | null;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const me = wallet?.address?.toLowerCase();
  const isUnderwriter = me === cover.underwriter.toLowerCase();
  const canAct = wallet?.onCorrectChain;

  // Timing gates the contract enforces. Surfacing them here means a user sees
  // "opens in 4 min" rather than discovering a revert after paying gas.
  const nowSecs = Math.floor(Date.now() / 1000);
  const windowOpened = nowSecs >= cover.policy.windowStart;
  const windowClosed = nowSecs >= cover.policy.windowEnd;
  const untilOpen = Math.ceil((cover.policy.windowStart - nowSecs) / 60);
  const untilClose = Math.ceil((cover.policy.windowEnd - nowSecs) / 60);

  async function run(fn: () => Promise<string>, label: string) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const hash = await fn();
      setMsg(`${label} — ${hash.slice(0, 10)}…`);
      onDone();
    } catch (e) {
      setErr(explainError(e));
    } finally {
      setBusy(false);
    }
  }

  if (cover.status === 'HEALTHY' || cover.status === 'CLAIMED' || cover.status === 'CANCELLED') {
    return null;
  }

  return (
    <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      {cover.status === 'OPEN' && !windowOpened && (
        <button
          className="btn primary"
          disabled={busy || !canAct}
          onClick={() => run(() => buyCover(cover.id, cover.originalPremium), 'Cover purchased')}
        >
          Buy this cover for {fmtCtc(cover.originalPremium)}
        </button>
      )}

      {cover.status === 'OPEN' && !windowOpened && (
        <span className="footnote" style={{ margin: 0 }}>
          Coverage opens in {untilOpen} min — buy before then.
        </span>
      )}

      {cover.status === 'OPEN' && windowOpened && (
        <span className="footnote" style={{ margin: 0, color: 'var(--amber)' }}>
          No longer purchasable — the coverage window already opened, so the outcome is partly
          observable. The underwriter can cancel and reclaim the collateral.
        </span>
      )}

      {cover.status === 'OPEN' && isUnderwriter && (
        <button
          className="btn"
          disabled={busy || !canAct}
          onClick={() => run(() => cancelCover(cover.id), 'Cover cancelled, collateral returned')}
        >
          Cancel and reclaim collateral
        </button>
      )}

      {cover.status === 'ACTIVE' && (
        <button
          className="btn"
          disabled={busy || !canAct || !windowClosed}
          onClick={() => run(() => settle(cover.id), 'Settled')}
        >
          Settle this cover
        </button>
      )}

      {cover.status === 'ACTIVE' && (
        <span className="footnote" style={{ margin: 0 }}>
          {windowClosed
            ? 'Anyone may settle — it can only pay out according to evidence already verified. If Attestcoin has not yet attested the window\'s end, this will say so and you can retry shortly.'
            : `Coverage closes in ${untilClose} min. Settlement is only possible after that, plus roughly 8 minutes for Attestcoin to attest the final blocks.`}
        </span>
      )}

      {!canAct && wallet && <span className="footnote" style={{ margin: 0 }}>Switch to Creditcoin to act.</span>}
      {!wallet && <span className="footnote" style={{ margin: 0 }}>Connect a wallet to act.</span>}
      {msg && <span style={{ color: 'var(--green)', fontSize: 13 }}>{msg}</span>}
      {err && <span style={{ color: 'var(--red)', fontSize: 13 }}>{err}</span>}
    </div>
  );
}
