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

type Tab = 'covers' | 'evidence' | 'health' | 'trust';

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

  useEffect(() => {
    (async () => {
      try {
        const [cs, h] = await Promise.all([getAllCovers(), getProofHealth()]);
        setCovers(cs);
        setHealth(h);
        setSelected(cs.length ? cs[cs.length - 1].id : null);

        const ev: Record<number, Evidence[]> = {};
        const st: Record<number, Settlement | null> = {};
        const pv: Record<number, number[]> = {};
        for (const c of cs) {
          ev[c.id] = await getEvidence(c.id);
          st[c.id] = await getSettlement(c.id);
          pv[c.id] = await getProvisional(c.policy, ev[c.id]);
        }
        setEvidence(ev);
        setSettlements(st);
        setProvisional(pv);
      } catch (e: any) {
        setErr(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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

      {!loading && tab === 'health' && health && <ProofHealthPanel health={health} />}
      {!loading && tab === 'trust' && <TrustBoundary />}
    </div>
  );
}
