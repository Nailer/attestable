import { useState } from 'react';
import { ethers } from 'ethers';
import { useSettings, DEFAULTS, type Settings } from '../lib/settings';
import { CONFIG } from '../lib/config';

function Seg<T extends string | number | boolean>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={String(o.value)}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="setting">
      <div className="setting-head">
        <div>
          <div className="setting-title">{title}</div>
          <div className="setting-desc">{desc}</div>
        </div>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function SettingsPanel() {
  const [settings, update] = useSettings();
  const [rpcDraft, setRpcDraft] = useState(settings.sepoliaRpc);
  const [rpcCheck, setRpcCheck] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  /**
   * Test an endpoint the way the app will actually use it: chain identity, plus
   * whether it serves logs from far enough back to discover older evidence.
   * "Responds to a ping" is not the property that matters here.
   */
  async function testRpc() {
    setChecking(true);
    setRpcCheck(null);
    try {
      const url = rpcDraft.trim() || CONFIG.sepoliaRpc;
      const p = new ethers.JsonRpcProvider(url, new ethers.Network('sepolia', 11155111), {
        staticNetwork: new ethers.Network('sepolia', 11155111),
      });
      const net = await p.getNetwork();
      if (Number(net.chainId) !== 11155111) {
        setRpcCheck(`Wrong network — this endpoint is chain ${net.chainId}, not Sepolia (11155111).`);
        return;
      }
      const head = await p.getBlockNumber();

      // Probe roughly 30,000 blocks back — past what public endpoints retain.
      const deep = head - 30_000;
      let depth = 'unknown';
      try {
        await p.getLogs({
          address: CONFIG.aggregator,
          topics: [CONFIG.answerUpdatedTopic],
          fromBlock: deep,
          toBlock: deep + 9,
        });
        depth = 'archive history available ✓';
      } catch (e: any) {
        const m = String(e?.message ?? '');
        depth = /up to a (\d+) block range/.test(m)
          ? 'archive available, but capped block ranges (fine — we query narrowly)'
          : 'recent blocks only — older windows will appear empty';
      }
      setRpcCheck(`Sepolia ✓ · head ${head.toLocaleString()} · ${depth}`);
    } catch (e: any) {
      setRpcCheck(`Unreachable: ${e?.shortMessage ?? e?.message ?? e}`);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="panel">
      <h2>Settings</h2>
      <p className="sub">Stored in this browser only. Nothing is sent anywhere.</p>

      <Row
        title="Appearance"
        desc="System follows your operating system's light or dark preference."
      >
        <Seg<Settings['theme']>
          value={settings.theme}
          onChange={(theme) => update({ theme })}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
          ]}
        />
      </Row>

      <Row
        title="Timestamps"
        desc="Evidence carries the feed's own updatedAt value, which is always UTC. Showing local time is easier to read but can make a gap look like it happened at a different hour than the chain records."
      >
        <Seg<Settings['timeMode']>
          value={settings.timeMode}
          onChange={(timeMode) => update({ timeMode })}
          options={[
            { value: 'utc', label: 'UTC' },
            { value: 'local', label: 'Local time' },
          ]}
        />
      </Row>

      <Row
        title="Sepolia endpoint for evidence discovery"
        desc={
          <>
            <b>The setting that matters most.</b> Public endpoints keep only about the last 10,000
            blocks of logs. Ask one for a window older than roughly a day and it returns{' '}
            <i>nothing</i> — which looks identical to "the feed never updated". An archive endpoint
            (Alchemy or Infura free tier) removes that failure mode. Leave blank to use the default
            public endpoint.
          </>
        }
      >
        <input
          type="text"
          placeholder={CONFIG.sepoliaRpc}
          value={rpcDraft}
          onChange={(e) => setRpcDraft(e.target.value)}
          spellCheck={false}
        />
        <button className="btn" disabled={checking} onClick={testRpc}>
          {checking ? 'Testing…' : 'Test'}
        </button>
        <button
          className="btn primary"
          onClick={() => update({ sepoliaRpc: rpcDraft.trim() })}
          disabled={rpcDraft.trim() === settings.sepoliaRpc}
        >
          Save
        </button>
        {rpcCheck && (
          <span
            style={{
              fontSize: 12,
              color: rpcCheck.includes('✓') ? 'var(--green)' : 'var(--amber)',
              flexBasis: '100%',
            }}
          >
            {rpcCheck}
          </span>
        )}
      </Row>

      <Row
        title="Gas head-room on proof submissions"
        desc="Proof verification cost is dominated by a large fixed component — decoding a ~3kB receipt and searching its logs — not by proof size. Two early submissions ran out of gas because the reference formula modelled only the precompile call. Raise this if submissions fail with an out-of-gas error."
      >
        <Seg<number>
          value={settings.gasMarginPct}
          onChange={(gasMarginPct) => update({ gasMarginPct })}
          options={[
            { value: 0, label: 'None' },
            { value: 25, label: '+25%' },
            { value: 50, label: '+50%' },
            { value: 100, label: '+100%' },
          ]}
        />
      </Row>

      <Row
        title="Show unverified observations"
        desc="Updates seen directly on Ethereum but with no Creditcoin proof yet. They are never settlement input and are always styled distinctly — hide them if you want to see only what the contract itself has verified."
      >
        <Seg<boolean>
          value={settings.showProvisional}
          onChange={(showProvisional) => update({ showProvisional })}
          options={[
            { value: true, label: 'Show' },
            { value: false, label: 'Verified only' },
          ]}
        />
      </Row>

      <Row
        title="Auto-refresh"
        desc="Re-reads chain state on a timer. Each refresh makes several RPC calls per cover, so leave it off unless you are watching a cover progress."
      >
        <Seg<number>
          value={settings.refreshSecs}
          onChange={(refreshSecs) => update({ refreshSecs })}
          options={[
            { value: 0, label: 'Off' },
            { value: 30, label: '30s' },
            { value: 60, label: '1 min' },
            { value: 300, label: '5 min' },
          ]}
        />
      </Row>

      <div className="setting">
        <button
          className="btn"
          onClick={() => {
            update(DEFAULTS);
            setRpcDraft('');
            setRpcCheck(null);
          }}
        >
          Reset to defaults
        </button>
      </div>
    </div>
  );
}
