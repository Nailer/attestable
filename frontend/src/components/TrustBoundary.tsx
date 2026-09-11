import { CONFIG } from '../lib/config';

/**
 * The Trust Boundary panel.
 *
 * Most projects claim to be trustless. Stating precisely where trust actually
 * remains is more useful and far more defensible — and it answers the sharpest
 * questions before anyone has to ask them.
 */
export function TrustBoundary() {
  return (
    <div className="panel">
      <h2>Trust boundary</h2>
      <p className="sub">
        What is proven cryptographically, and what is not — stated plainly.
      </p>

      <div className="trust">
        <div className="yes">
          <h3>✓ Verified cryptographically</h3>
          <ul>
            <li><b>Source-chain identity</b> — evidence came from the chain the policy names</li>
            <li><b>Transaction inclusion</b> — Merkle proof against the block's transaction trie</li>
            <li><b>Chain descent</b> — continuity proof to a block the attestor set signed</li>
            <li><b>Transaction success</b> — receipt status checked explicitly, because the precompile does not</li>
            <li><b>Event emitter</b> — the exact aggregator the policy names, not a lookalike</li>
            <li><b>Event shape</b> — three topics, one data word; this is what pins the layout</li>
            <li><b>Window membership</b> — timestamp falls inside the covered period</li>
            <li><b>No double-counting</b> — evidence consumed per cover</li>
            <li><b>Attestation state</b> — settlement blocked until proofs were obtainable</li>
          </ul>
        </div>

        <div className="no">
          <h3>✗ Not claimed</h3>
          <ul>
            <li><b>That Chainlink agreed to anything.</b> They sign nothing, stake nothing, receive nothing, and need not know this exists</li>
            <li><b>That the price is correct.</b> We cover silence, never inaccuracy — judging correctness would need an oracle, which is what we are avoiding</li>
            <li><b>That absence was proven.</b> Attestcoin proves inclusion; it cannot prove a non-event. Our finding is narrower: <i>insufficient valid evidence arrived before an attestation-safe deadline</i></li>
            <li><b>That all trust is removed.</b> Trust remains in Attestcoin's attestor set and in Chainlink's honesty about its own feed</li>
            <li><b>That this is a regulated insurance product.</b> It is a working prototype</li>
          </ul>
        </div>
      </div>

      <p className="footnote">
        <b>The attack this design exists to stop.</b> Cryptography proves something{' '}
        <i>happened</i>; it cannot prove it was <i>meaningful</i>. Anyone can deploy a contract that
        emits a fabricated price and obtain a perfectly genuine proof of it. The proof would be
        real; the evidence worthless. Checking the emitter is what separates the two — and we tested
        exactly that attack against the live precompile on Creditcoin. It was rejected.
      </p>
      <p className="footnote">
        Contracts:{' '}
        <a href={`${CONFIG.explorers.creditcoin}/address/${CONFIG.coverAddress}`} target="_blank" rel="noreferrer">
          AttestableCover ↗
        </a>{' '}
        ·{' '}
        <a href={`${CONFIG.explorers.creditcoin}/address/${CONFIG.ascAddress}`} target="_blank" rel="noreferrer">
          AttestableASC ↗
        </a>
      </p>
    </div>
  );
}
