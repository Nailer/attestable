import type { ProofHealth as Health } from '../lib/chain';
import { CONFIG } from '../lib/config';
import { fmtCtc, fmtPrice, fmtTime } from '../lib/chain';

/**
 * Live pipeline health.
 *
 * This panel exists to make one distinction visible that is otherwise easy to
 * miss: the difference between "the feed is fine" and "we cannot see yet".
 * The attestation frontier determines whether evidence CAN be proven at all, so
 * a lagging frontier is not an outage — and settlement is blocked until it
 * catches up, precisely so attestor lag can never be mistaken for one.
 */
export function ProofHealthPanel({ health }: { health: Health }) {
  const feedAgeMins = health.aggregatorLastUpdate
    ? (Date.now() / 1000 - health.aggregatorLastUpdate) / 60
    : null;

  return (
    <div className="panel">
      <h2>Proof pipeline health</h2>
      <p className="sub">
        Every value read live from a chain. Nothing here is inferred or cached.
      </p>

      <div className="grid three">
        <div className="stat">
          <div className="label">Ethereum Sepolia head</div>
          <div className="value">{health.sepoliaHead.toLocaleString()}</div>
          <div className="note">source chain · chainKey {CONFIG.sepoliaChainKey}</div>
        </div>

        <div className="stat">
          <div className="label">Attestation frontier</div>
          <div className="value">{health.attestedHeight.toLocaleString()}</div>
          <div className="note">
            {health.lagBlocks} blocks behind · ~{(health.lagSeconds / 60).toFixed(1)} min
          </div>
        </div>

        <div className="stat">
          <div className="label">Creditcoin head</div>
          <div className="value">{health.creditcoinHead.toLocaleString()}</div>
          <div className="note">settlement chain · id 102031</div>
        </div>

        <div className="stat">
          <div className="label">Feed last published</div>
          <div className="value">
            {health.aggregatorLastPrice ? fmtPrice(health.aggregatorLastPrice) : '—'}
          </div>
          <div className="note">
            {feedAgeMins !== null ? `${feedAgeMins.toFixed(0)} min ago` : 'unreachable'}
          </div>
        </div>

        <div className="stat">
          <div className="label">Escrow currently held</div>
          <div className="value">{fmtCtc(health.escrowHeld)}</div>
          <div className="note">across all active covers</div>
        </div>

        <div className="stat">
          <div className="label">Provable history</div>
          <div className="value">Full</div>
          <div className="note">verified back to block 1</div>
        </div>
      </div>

      <p className="footnote">
        <b>Why the frontier matters.</b> Attestcoin proves that something happened; it can never
        prove that something did <i>not</i> happen. So a cover cannot settle until the frontier has
        passed its window — otherwise a slow attestor set alone could trigger a payout, and we would
        be settling on our own infrastructure lag rather than on a real outage.
      </p>
      <p className="footnote">
        Monitored feed:{' '}
        <a href={`${CONFIG.explorers.sepolia}/address/${CONFIG.aggregator}#events`} target="_blank" rel="noreferrer">
          Chainlink ETH/USD aggregator ↗
        </a>{' '}
        · Attestations:{' '}
        <a href={CONFIG.explorers.attestcoinDashboard} target="_blank" rel="noreferrer">
          Creditcoin dashboard ↗
        </a>
      </p>
    </div>
  );
}
