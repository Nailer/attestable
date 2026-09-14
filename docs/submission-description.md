# Attestable

**Attestable turns verified blockchain events into automatic financial protection.**

DeFi protocols already know when their infrastructure fails. A stale price feed is easy to
detect. What no protocol can do today is *transfer the cost of that failure to someone willing
to carry it.* Detection tells you something went wrong. It doesn't pay for it.

Attestable is the missing half: a market where infrastructure risk has a counterparty, a price,
and a settlement that runs without anyone's permission.

---

## The problem

If you run a lending protocol, you need to know what ETH is worth. You get that from a price
feed. When the feed goes quiet, you cannot safely liquidate, you cannot safely lend, and every
minute of silence is a minute your positions drift away from reality.

Three things make this risk unusually ugly:

1. **You don't control it.** The feed is operated by someone else, for their own reasons.
2. **You can't claim against it.** The operator never signed a contract with you, never promised
   uptime, and owes you nothing when it stops.
3. **You can't hedge it.** There is no instrument, no market, and no counterparty.

So the risk sits on your balance sheet, unpriced and uninsured. Every protocol absorbs it
silently, and the only available mitigation is over-collateralisation, which is expensive and
permanent.

---

## What Attestable does

Attestable creates a simple two-sided market around that risk.

```
Buyer pays a premium
        ↓
Underwriter locks collateral
        ↓
Verified on-chain evidence determines the outcome
        ↓
The contract settles automatically
```

**For buyers** — choose the infrastructure you depend on, the period you want covered, and the
delay you can tolerate. Pay the premium. If the infrastructure fails past your tolerance, you
receive the collateral.

**For underwriters** — browse open covers, post the collateral, and earn the premium for taking
a risk that usually doesn't happen. This is yield that is uncorrelated with token price, which
is rare.

**The infrastructure provider is not a participant.** They sign nothing, stake nothing, receive
nothing, and do not need to know Attestable exists — exactly as a rainfall insurance policy
needs no permission from the weather.

---

## The first product: price-feed inactivity

Our first cover protects against a price feed going silent.

A policy names four things: the source chain, the exact contract being watched, the event that
counts as "alive", and the maximum silence tolerated between updates.

| Outcome | Condition | Who gets paid |
|---|---|---|
| **HEALTHY** | No gap between verified updates exceeded the tolerance | Underwriter receives collateral **and** keeps the premium |
| **CLAIMED** | Some gap exceeded the tolerance | Buyer receives the collateral; underwriter still keeps the premium |

Note the second row: on a claim the underwriter still keeps what they were paid. They sold
protection and it was used. That is insurance, not a bet.

### The number that changed our design

Chainlink's ETH/USD feed documents a **60-minute** heartbeat. We measured it against real
history instead of trusting the specification, and its worst gap **on a completely healthy day
is 61.6 minutes.**

A policy written from the documentation would have paid claims against infrastructure that was
working perfectly. This single measurement is why our default tolerance is 90 minutes, and it is
the strongest argument we have that this was built against reality rather than a spec sheet.

---

## Proof it works — real deployments, real money

Everything below is live on Creditcoin CC3 Testnet and independently verifiable. No mocks, no
simulated outages, no staged data.

### Settled covers

| Outcome | Measured worst gap | Tolerance | Proofs | Settlement |
|---|---|---|---|---|
| **CLAIMED** | **773.6 min** — a real outage | 90 min | 2 | [`0xdf52e5ad…`](https://creditcoin-testnet.blockscout.com/tx/0xdf52e5adbb2ba5677225f4514981989f5730482cccc2fa11420c0ec5613f28cd?tab=internal) |
| HEALTHY | 61.6 min | 90 min | 7 | [`0x801da47a…`](https://creditcoin-testnet.blockscout.com/tx/0x801da47a335bb11898d78c5fdc49b04e8af19ba75248017c7c0ab2ab2bd253aa) |
| HEALTHY | 61.6 min | 90 min | 3 | [`0x2c090c1d…`](https://creditcoin-testnet.blockscout.com/tx/0x2c090c1d011660dd6de59aa938958394c03bf3258a9740b59b69baa2b7ba4187) |

### The outage was real

On **31 August 2026**, the Chainlink ETH/USD aggregator on Ethereum Sepolia went silent from
**00:37 UTC to 13:30 UTC** — a gap of **773.6 minutes**, just under thirteen hours.

We did not invent it, and we could not have. The evidence is naturally occurring: Chainlink's
node operators publish to Sepolia for their own reasons, and we have no ability to influence
what they publish or when.

We wrote a policy over that exact window, proved the silence through Attestcoin, and let the
contract settle itself. **200 CTC of collateral moved to the buyer. 12 CTC of premium stayed
with the underwriter. No human approved any of it.**

> Open the settlement on the **Internal txns** tab. The transaction's own `Value` is `0` —
> settlement moves funds through internal calls, so the Details tab alone makes it look like
> nothing happened.

### The first proof ever verified

[`0x7c738788…`](https://creditcoin-testnet.blockscout.com/tx/0x7c738788da8d94543739b7a8797f43b7c9394ad663d51693e2bba5cbd713d4a1)
— block 5,434,308, gas 363,468. The first transaction in which a genuine Chainlink price
publication from Ethereum Sepolia was verified through Attestcoin's Block Prover inside a
Creditcoin contract and changed on-chain state. Decoded payload: **$2,390.75**, round 35735.

---

## How we use USC

Attestable can only exist on Creditcoin, because the entire product rests on one capability: a
contract being able to establish what happened on another chain without trusting anyone to tell
it. We use USC for two genuinely different jobs.

### 1. Proving an event happened — Block Prover (`0x…0FD2`)

When Chainlink publishes a price on Ethereum, we build a Merkle inclusion proof plus a
continuity proof down to a block the attestor set signed, and hand it to the Block Prover
precompile. It confirms that exact transaction really was in that Ethereum block.

Then we use the USC `EvmV1Decoder` to read the receipt and check **three things the proof itself
does not tell us**:

- **The transaction succeeded.** A proof shows a transaction existed. It does not show it
  didn't revert. We check `receiptStatus == 1` explicitly.
- **The emitter is the exact contract the policy names.** This is the attack that matters:
  anyone can deploy a contract that emits a fabricated price and obtain a *perfectly genuine*
  proof of it. The proof would be real and the evidence worthless. We match on event signature
  **and** emitting address together.
- **The evidence is unambiguous.** One transaction can carry several matching logs. If more than
  one matches, we reject rather than guess.

We ran that forgery attack against the live precompile on Creditcoin. The contract rejected it.

### 2. Knowing when it is safe to decide — ChainInfo (`0x…0FD3`)

A payout here depends partly on evidence *not* arriving — and that is dangerous, because if our
own proof pipeline were lagging, it would look identical to a genuine outage.

So before settling anything, the contract calls `is_height_attested` to ask whether Creditcoin's
attestation frontier has passed the end of the policy window. If it hasn't, **settlement is
blocked.**

This is the difference between an honest protocol and a broken one. We never claim to have
proven a negative. Our finding is narrower and defensible: *insufficient valid evidence arrived
before an attestation-safe deadline, at a point when it genuinely could have.*

### 3. Proof generation — USC SDK

The `@gluwa/usc-sdk` proof provider runs **in the browser**. A user needs nothing installed — no
CLI, no node, no local worker. Open the page, connect a wallet, submit proofs.

---

## What we verify, and what we don't claim

Most submissions tell you what they prove. Here is both.

**Verified cryptographically**

- Source-chain identity — evidence came from the chain the policy names
- Transaction inclusion — Merkle proof against the block's transaction trie
- Chain descent — continuity proof to a block the attestor set signed
- Transaction success — receipt status checked explicitly
- Event emitter — the exact aggregator named, not a lookalike
- Event shape — three topics, one data word
- Window membership — timestamp falls inside the covered period
- No double-counting — each piece of evidence consumed once per cover
- Attestation state — settlement blocked until proofs were obtainable

**Not claimed**

- That Chainlink agreed to anything. They sign nothing and need not know this exists.
- That the price is *correct*. We cover silence, never inaccuracy — judging correctness would
  require an oracle, which is the dependency we are trying to price.
- That absence was proven. Attestcoin proves inclusion; it cannot prove a non-event.
- That all trust is removed. Trust remains in Attestcoin's attestor set and in Chainlink's
  honesty about its own feed.
- That this is a regulated insurance product. It is a working prototype.

---

## Architecture

Two contracts, deliberately separated.

| Contract | Role | Address |
|---|---|---|
| **AttestableCover** | Holds premium and collateral, stores policy terms, settles. Never verifies a proof. | [`0xB560596E…7f89`](https://creditcoin-testnet.blockscout.com/address/0xB560596EcCfe690396E8BEC72EC0FaFFb6D87f89) |
| **AttestableASC** | Verifies evidence and reports findings. Never touches money. | [`0xDd1618a7…1775`](https://creditcoin-testnet.blockscout.com/address/0xDd1618a762cE8b4C9Bc849Bb6FF260519B221775) |

Split this way, a flaw in the verification path cannot drain the vault, and a flaw in the vault
cannot forge evidence.

**Earlier deployment** holding the settled history above:
[`0x87553eA8…Dc91`](https://creditcoin-testnet.blockscout.com/address/0x87553eA864e4cd16357Fa3D0D27F9F4e831aDc91) (Cover) ·
[`0xC8E0472a…Ffe8`](https://creditcoin-testnet.blockscout.com/address/0xC8E0472a5aA4bF6e6120c65682Cb19a65cb2Ffe8) (ASC)

### What is being watched

| | |
|---|---|
| Source chain | Ethereum Sepolia — Attestcoin `chainKey 1` |
| Monitored contract | [`0x719E22E3D4…14AE`](https://sepolia.etherscan.io/address/0x719E22E3D4b690E5d96cCb40619180B5427F14AE) — the Chainlink ETH/USD **aggregator** |
| Evidence event | `AnswerUpdated` · `0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f` |
| Settlement chain | Creditcoin CC3 Testnet · chainId **102031** |

> We watch the aggregator, not the proxy. The proxy forwards calls but emits no events — a
> policy written against it would never find evidence and would claim every time.

---

## Engineering

**51 tests, 0 failures**, across three suites:

| Suite | Tests | What it covers |
|---|---|---|
| `AttestableCover.t.sol` | 17 | Escrow, policy lifecycle, settlement arithmetic |
| `AttestableASC.t.sol` | 15 | Verification against a **real 3,168-byte chain fixture** |
| `Adversarial.t.sol` | 19 | Twelve numbered invariants and three live exploit attempts |

The verification suite runs against genuinely encoded transaction and receipt bytes captured
from Sepolia — not hand-written mocks that would pass a decoder we wrote ourselves.

### Two real vulnerabilities we found by attacking ourselves

1. **Settlement before the window closed.** `settle()` checked evidence but not the wall clock,
   so collateral could be drained the moment a cover went active. Fixing it broke seven existing
   tests — because those tests had been exercising the exploit without anyone noticing.
2. **Retrospective purchase.** A buyer could watch an outage begin and *then* buy cover on it.
   Now `buyCover()` reverts with `WindowAlreadyStarted` once the window opens. You cannot insure
   a house that is already burning.

### A third bug, found while preparing the demo

Our evidence scanner used a fixed 6,000-block lookback instead of the policy's own window. On a
24-hour cover that falls ~1,250 blocks short **at the start** — and because missing evidence
widens apparent silence, the scanner **manufactured a 314-minute outage that never happened.**

Both the worker and the browser now derive their range from the policy's `windowStartBlock`. A
scanning blind spot must never be able to produce a claim. We left the affected cover unsettled
rather than settle on a figure we knew was wrong.

---

## Try it yourself

No CLI, no local setup. Everything runs in the browser.

1. Open **[nailer.github.io/attestable](https://nailer.github.io/attestable/)**
2. Connect a wallet on Creditcoin CC3 Testnet (chainId `102031`) — get testnet CTC from the
   [faucet](https://creditcoin.org/)
3. **Coverage** — inspect any live cover, its full policy terms, and its verified evidence
4. **Evidence Explorer** — walk a single proof through all four steps, with links out to
   Etherscan and Blockscout at every hop
5. **Proof Health** — live cross-chain telemetry: Sepolia head, attestation frontier, Creditcoin
   head, last published price
6. **Trust Boundary** — what is proven and what is not, stated plainly
7. **Write a cover** — create your own policy, and buy or underwrite it

Every figure in the interface is read directly from the contract. The frontend computes no
outcome of its own.

---

## Links

| | |
|---|---|
| **Live app** | https://nailer.github.io/attestable/ |
| **Documentation** | https://attestable.mintlify.app/ |
| **Pitch deck** | https://nailer.github.io/attestable/deck.html |
| **Source code** | https://github.com/Nailer/attestable |
| **Cover contract** | [`0xB560596EcCfe690396E8BEC72EC0FaFFb6D87f89`](https://creditcoin-testnet.blockscout.com/address/0xB560596EcCfe690396E8BEC72EC0FaFFb6D87f89) |
| **Verification contract** | [`0xDd1618a762cE8b4C9Bc849Bb6FF260519B221775`](https://creditcoin-testnet.blockscout.com/address/0xDd1618a762cE8b4C9Bc849Bb6FF260519B221775) |
| **The real outage claim** | [`0xdf52e5ad…`](https://creditcoin-testnet.blockscout.com/tx/0xdf52e5adbb2ba5677225f4514981989f5730482cccc2fa11420c0ec5613f28cd?tab=internal) |
| **Monitored feed** | [Chainlink ETH/USD aggregator, Sepolia](https://sepolia.etherscan.io/address/0x719E22E3D4b690E5d96cCb40619180B5427F14AE) |
| **Attestation dashboard** | https://dashboard.cc3-testnet.creditcoin.network |

---

## Where this goes

The first product covers price-feed liveness because it is the risk we could measure most
rigorously. The pattern generalises to anything with an on-chain, measurable failure signature:

- **Bridge liveness** — cover against a bridge halting mid-transfer
- **Sequencer uptime** — cover against an L2 sequencer stalling
- **RWA attestation delays** — cover against a custodian missing its reporting window
- **Multi-chain policies** — one cover watching several sources at once

The near-term technical milestone is multi-chain evidence within a single policy. Ethereum
mainnet is already attested by Attestcoin and we confirmed the aggregator resolves there; we cut
it from this build rather than ship it half-working.

The near-term *business* milestone is not technical at all. It is one design partner — a lending
protocol that has already been burned by oracle latency and remembers it.

**Honest about the market:** nobody is hedging oracle-staleness today. The risk is real and
measurable, the loss mechanism is concrete, and we have no signed customers. We would rather
state that plainly than overclaim a market that does not yet exist.

---

*Built solo for BUIDL CTC 2026 Fall by Emmanuel Aje Ayoola.*
