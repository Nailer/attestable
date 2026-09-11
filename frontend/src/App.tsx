import { useEffect, useState } from 'react';
import {
  getAllCovers,
  getEvidence,
  getSettlement,
  getProofHealth,
  getProvisional,
  fmtCtc,
  type Cover,
  type Evidence,
  type Settlement,
  type ProofHealth,
} from './lib/chain';
import { CONFIG } from './lib/config';
import { CoverCard } from './components/CoverCard';
import { EvidenceExplorer } from './components/EvidenceExplorer';
import { ProofHealthPanel } from './components/ProofHealth';
import { TrustBoundary } from './components/TrustBoundary';
import { ConnectBar, CreateCoverForm, CoverActions } from './components/Actions';
import { currentState, type WalletState } from './lib/wallet';
import { SubmitEvidencePanel } from './components/SubmitEvidence';

type Tab = 'covers' | 'write' | 'evidence' | 'health' | 'trust';

export default function App() {
  const [tab, setTab] = useState<Tab>('covers');
  const [covers, setCovers] = useState<Cover[]>([]);
  const [evidence, setEvidence] = useState<Record<number, Evidence[]>>({});
  const [settlements, setSettlements] = useState<Record<number, Settlement | null>>({});
  const [provisional, setProvisional] = useState<Record<number, number[]>>({});
  const [health, setHealth] = useState<ProofHealth | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    currentState().then(setWallet).catch(() => {});
    const e = (window as any).ethereum;
    if (e?.on) {
      e.on('accountsChanged', () => currentState().then(setWallet));
      e.on('chainChanged', () => currentState().then(setWallet));
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [cs, h] = await Promise.all([getAllCovers(), getProofHealth()]);
        setCovers(cs);
        setHealth(h);
        setSelected(cs.length ? cs[cs.length - 1].id : null);

        // Show the covers immediately. Evidence needs several log queries per
        // cover, and blocking the whole page on them left a spinner up for
        // 15+ seconds — long enough that a visitor assumes it is broken.
        setLoading(false);

        // Then fill in evidence per cover, in parallel, updating as each lands.
        await Promise.all(
          cs.map(async (c) => {
            try {
              const [e, st] = await Promise.all([getEvidence(c.id), getSettlement(c.id)]);
              setEvidence((prev) => ({ ...prev, [c.id]: e }));
              setSettlements((prev) => ({ ...prev, [c.id]: st }));
              const pv = await getProvisional(c.policy, e);
              setProvisional((prev) => ({ ...prev, [c.id]: pv }));
            } catch {
              // one cover failing must not blank the rest of the page
            }
          })
        );
      } catch (e: any) {
        setErr(e?.message ?? String(e));
        setLoading(false);
      }
    })();
  }, [reloadKey]);

  const settled = covers.filter((c) => c.status === 'HEALTHY' || c.status === 'CLAIMED');
  const totalVerified = Object.values(evidence).reduce((n, e) => n + e.length, 0);
  const active = covers.find((c) => c.id === selected);

  return (
    <div className="wrap">
      <header className="header">
        <h1>Attestable</h1>
        <p className="tag">
          Parametric coverage for blockchain infrastructure failure — settled by cryptographic proof
          of what happened on another chain, not by a claims process.
        </p>
        <div className="chips">
          <span className="chip">
            <b>{covers.length}</b> covers
          </span>
          <span className="chip">
            <b>{settled.length}</b> settled
          </span>
          <span className="chip">
            <b>{totalVerified}</b> verified proofs
          </span>
          {health && (
            <span className="chip">
              frontier <b>{health.lagBlocks}</b> blocks behind
            </span>
          )}
          {health && (
            <span className="chip">
              escrow <b>{fmtCtc(health.escrowHeld)}</b>
            </span>
          )}
          <span className="chip">Creditcoin CC3 Testnet</span>
        </div>
      </header>

      <nav className="tabs">
        <button className={`tab ${tab === 'covers' ? 'active' : ''}`} onClick={() => setTab('covers')}>
          Coverage
        </button>
        <button className={`tab ${tab === 'write' ? 'active' : ''}`} onClick={() => setTab('write')}>
          Write a cover
        </button>
        <button className={`tab ${tab === 'evidence' ? 'active' : ''}`} onClick={() => setTab('evidence')}>
          Evidence Explorer
        </button>
        <button className={`tab ${tab === 'health' ? 'active' : ''}`} onClick={() => setTab('health')}>
          Proof Health
        </button>
        <button className={`tab ${tab === 'trust' ? 'active' : ''}`} onClick={() => setTab('trust')}>
          Trust Boundary
        </button>
      </nav>

      <ConnectBar wallet={wallet} onChange={setWallet} />

      {err && <div className="err">Could not read chain state: {err}</div>}
      {loading && <div className="loading">Reading live state from Creditcoin…</div>}

      {!loading && tab === 'covers' && (
        <>
          {covers.length === 0 && <div className="panel">No covers written yet.</div>}
          {covers.map((c) => (
            <CoverCard
              key={c.id}
              cover={c}
              evidence={evidence[c.id] ?? []}
              settlement={settlements[c.id] ?? null}
              selected={c.id === selected}
              onSelect={() => setSelected(c.id)}
              actions={
                <CoverActions cover={c} wallet={wallet} onDone={() => setReloadKey((k) => k + 1)} />
              }
              evidencePanel={
                <SubmitEvidencePanel
                  cover={c}
                  wallet={wallet}
                  onDone={() => setReloadKey((k) => k + 1)}
                />
              }
            />
          ))}
          <p className="footnote">
            Every figure above is read directly from{' '}
            <a href={`${CONFIG.explorers.creditcoin}/address/${CONFIG.coverAddress}`} target="_blank" rel="noreferrer">
              the contract on Creditcoin ↗
            </a>
            . This interface computes no outcome of its own — it displays what the chain already
            decided.
          </p>
        </>
      )}

      {!loading && tab === 'evidence' && (
        <>
          {covers.length > 1 && (
            <div className="panel" style={{ paddingBottom: 12 }}>
              <h2>Select a cover</h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                {covers.map((c) => (
                  <button
                    key={c.id}
                    className={`tab ${c.id === selected ? 'active' : ''}`}
                    onClick={() => setSelected(c.id)}
                  >
                    Cover #{c.id} · {c.status}
                  </button>
                ))}
              </div>
            </div>
          )}
          {active && (
            <EvidenceExplorer
              cover={active}
              evidence={evidence[active.id] ?? []}
              provisional={provisional[active.id] ?? []}
            />
          )}
        </>
      )}

      {!loading && tab === 'write' && (
        <CreateCoverForm onDone={() => setReloadKey((k) => k + 1)} />
      )}

      {!loading && tab === 'health' && health && <ProofHealthPanel health={health} />}
      {!loading && tab === 'trust' && <TrustBoundary />}
    </div>
  );
}
