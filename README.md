# Attestable

**A programmable protection layer for blockchain infrastructure.**

Coverage that settles on cryptographic proof of what happened on another chain — verified natively on Creditcoin through the Attestcoin Protocol, not by a claims committee, an administrator, or a trusted API.

Built for **BUIDL CTC 2026 Fall**.

---

## Build status

> This project is under active development for the hackathon window (Aug–Sep 2026). Commits are incremental and the history reflects the real build order.

| Component | Status |
|---|---|
| Technical spike — real proof, end to end | 🔴 not started |
| `AttestableASC` (verification) | 🔴 not started |
| `AttestableCover` (policy + settlement) | 🔴 not started |
| Proof worker | 🔴 not started |
| Frontend | 🔴 not started |

**Nothing in this README describes working software yet.** No component is claimed functional until a real testnet transaction hash is published here to prove it.

---

## The problem

Protocols depend on infrastructure they do not control — price oracles, bridges, keeper networks, sequencers. When that infrastructure degrades, the losses are real and well documented: a stale price feed mis-prices liquidations, a stalled bridge strands funds, a missed keeper execution leaves a position unmanaged.

There is no good way to hedge that risk on-chain today. Existing cover products settle by claims assessment — a vote, a committee, or an administrator decides after the fact whether the event "counted." That reintroduces exactly the discretionary trust the rest of DeFi works to remove.

## The approach

Attestable writes coverage whose settlement condition is evaluated from **cryptographically verified external-chain evidence**.

A coverage buyer — a protocol with genuine exposure to an infrastructure failure — purchases protection against a precisely defined condition. An underwriter posts collateral and takes the premium. The condition is evaluated by a Creditcoin smart contract reading proofs of real events that occurred on another blockchain.

Neither party can influence the outcome, which is what makes the risk insurable rather than manipulable.

**MVP:** coverage against Chainlink price-feed staleness on Ethereum Sepolia.
**Platform:** the same policy engine generalises to bridge delivery, keeper execution, cross-chain messaging, sequencer liveness, and RPC availability.

## How it works

```
Chainlink aggregator (Ethereum)
        │  emits events independently, on its own schedule
        ▼
   Proof worker
        │  watch → wait for attestation frontier → build proof → submit
        ▼
   AttestableASC  (Creditcoin)
        │  Block Prover precompile verifies inclusion + continuity
        │  decode receipt, require status == 1, match event + emitter
        ▼
   AttestableCover  (Creditcoin)
        │  attestation-frontier gate → evaluate policy → settle
        ▼
   Premium and collateral move automatically
```

The worker is a **proof courier, not a decision maker**. It watches, waits, proves, and submits. It never decides validity, never computes settlement, and is never a source of truth. Every decision happens inside the Creditcoin contract, against evidence the contract verified itself.

## Why Attestcoin

Without it, a Creditcoin contract has no way to know what happened on Ethereum. It would have to trust an oracle, an indexer, an API, or our own backend saying "the feed went stale." Every one of those is a discretionary trust assumption of the kind this product exists to eliminate.

With it, the contract independently verifies that a specific transaction was included in a specific Ethereum block, that the block belongs to the attested chain, that the transaction succeeded, and that the expected event was emitted by the expected contract — before any money moves.

Attestcoin is not a feature of this product. It is the mechanism the product is built on.

## Why Creditcoin

The policy engine evaluates conditions spanning **multiple external chains**. Ethereum cannot natively verify state from another chain; Creditcoin can, through Attestcoin. Creditcoin is where evidence from several independent environments is combined into a single financial policy and settled.

## What is verified, and what is not

Being precise about this matters more than sounding impressive.

**Verified cryptographically**
- Source-chain identity and source block
- Transaction inclusion, via Merkle and continuity proofs
- Transaction success (`status == 1`, checked explicitly — the precompile does not check this)
- Event emitter address and event signature
- Event data required by the policy
- Evidence falls inside the policy window
- Evidence has not already been counted for this coverage
- Attestation state at the time of settlement

**Not claimed**
- That Chainlink has entered into any agreement with this project
- That the feed's reported price is truthful
- That absence of an event has been proven — see below
- That Attestcoin removes all trust assumptions
- That this prototype is a regulated insurance product

## On proving absence

Attestcoin proves that evidence **exists**. It cannot prove that something did not happen.

So Attestable never claims to have proven a feed went stale. Its finding is narrower and honest: *insufficient valid evidence was submitted before an attestation-safe deadline.* Coverage may only finalize once the attestation frontier has advanced past the evidence window, so a lagging attestor set can never itself trigger a payout.

## Repository layout

```
contracts/    AttestableASC.sol, AttestableCover.sol, libraries/
worker/       source-monitor, proof-generator, creditcoin-submitter
frontend/     coverage, evidence explorer
test/         unit/, integration/, adversarial/
SPEC.md       full technical specification
```

## Deployments

No contracts deployed yet. Addresses and verification links will be published here as they go live.

| Contract | Network | Address |
|---|---|---|
| — | — | — |

## Roadmap

- **Now** — Chainlink feed reliability on Ethereum Sepolia
- **Next** — multi-chain policies combining evidence from several source chains
- **Then** — bridge delivery, keeper execution, cross-chain messaging, sequencer and RPC liveness

## License

MIT
