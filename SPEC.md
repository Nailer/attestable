# Attestable — Technical Spec

**BUIDL CTC 2026 Fall.** Status: architecture frozen pending Day-1 spike results. Next action is the spike, not implementation.

---

## 1. Product

> **Attestable** is a programmable protection layer for blockchain infrastructure. Coverage settles on cryptographic proof of external-chain state, verified natively on Creditcoin through the Attestcoin Protocol — not on a claims vote, an oracle report, or a trusted API.

**MVP:** parametric coverage against Chainlink price-feed staleness on Ethereum Sepolia.
**Platform:** the same policy engine generalises to bridge delivery, keeper execution, cross-chain messaging, sequencer liveness, and RPC availability. Build only the first; make the architecture show the rest.

**Never claim** Chainlink is a counterparty or has agreed to anything. The contract is between a coverage buyer and an underwriter, *about* publicly observable infrastructure behaviour.

---

## 2. Why each chain is here

Both answers go in the README, deck, and video narration — stated early, before anyone asks.

**Why is the evidence on Ethereum?** Because it already is. Chainlink's aggregator events are emitted by Chainlink's node operators on their own schedule for their own reasons. They exist whether or not Attestable exists, and anyone can verify them on Etherscan.

**Why does settlement happen on Creditcoin?** Because the policy engine evaluates conditions spanning multiple external chains, which Ethereum cannot do natively. Both source chains are officially confirmed available: **chain key 1 = Sepolia, chain key 3 = Ethereum mainnet.** A single-source policy would be simpler on Ethereum; the architecture's point is multi-source.

---

## 3. Evidence source — to be determined by the spike, not assumed

Sepolia ETH/USD proxy: `0x694AA1769357215DE4FAC081bf1f309aDC325306`. Verified live 2026-08-27: $2505.11, last update 60.3 min prior.

**Do not hardcode `AnswerUpdated`.** The proxy does not emit it — the underlying aggregator does. Resolve via `aggregator()`, then inspect that contract's *actual historical logs*. Modern OCR2 aggregators may emit `NewTransmission` as the primary event. The policy's event signature is decided by what the spike observes, not by what documentation suggests.

Per Creditcoin (Q8), the decoded receipt gives `status (uint8)`, `gasUsed`, `logs[] = (address, bytes32[] topics, bytes data)`, `logsBloom`.

**Match evidence on `log.address`, never on `from`.** Creditcoin warned that `from` is only the gas payer. On an OCR aggregator, `from` is whichever oracle node transmitted that round — **it rotates between rounds**. The aggregator address in `log.address` is stable. Matching on `from` would break unpredictably.

---

## 4. Policy model — frozen by the spike, not invented during implementation

Two prior revisions of this section were wrong, in different ways. Both are recorded here so the same mistakes aren't made again during implementation.

**Wrong #1 — event counting.** `totalEvents >= N` over a window measures *activity*, not *staleness*. A feed that fires 24 times in one hour then goes dark for 23 hours passes a "≥24 per day" test while being catastrophically stale — precisely the failure the buyer is hedging.

**Wrong #2 — naive bucketing.** "At least one event inside each fixed bucket" is *also* not equivalent to a maximum-gap guarantee, because events can sit at opposite edges of adjacent buckets. Updates at 12:59 and 13:02 fill both the 12:00 and 13:00 buckets while leaving a real gap of only 3 minutes — fine. But updates at 12:01 and 13:59 also fill both buckets while leaving a **118-minute gap**. Bucket occupancy does not bound the interval between consecutive events.

**Therefore the semantics are not chosen here.** The two candidates are:

- **Max-interval:** no gap between consecutive verified updates may exceed `X` seconds. Correct by construction, but may require proving *every* update in the window plus the boundary events — proof count scales with cadence, and at ~450k gas per submission that can become economically absurd for a fast feed.
- **Bucket occupancy:** at least `M` verified updates inside each fixed sub-window. Bounds proof count to a tunable parameter, but only approximates a staleness guarantee, with the boundary weakness above.

The choice depends on facts the spike measures: the real update cadence, the provable historical window, and whether multiple proofs can share a continuity proof. A feed updating hourly makes max-interval affordable over a day (~24 proofs). A feed updating every 30 seconds does not (~2,880 proofs).

> **Rule: the Phase-1 spike report freezes the exact policy semantics, in mathematical terms. Phase 2 implements precisely that. No gap or bucket algorithm may be invented during implementation.**

The struct below is illustrative of shape only. Its condition fields are finalized by the spike.

```solidity
struct EvidencePolicy {
    uint64  chainKey;          // 1 = Sepolia, 3 = Ethereum mainnet
    address sourceContract;    // resolved aggregator (NOT the proxy)
    bytes32 eventSignature;    // determined by spike
    uint64  windowStartBlock;
    uint64  windowEndBlock;
    // --- condition fields frozen by the spike report ---
    uint32  toleranceSecs;     // max-interval bound, or bucket duration
    uint32  requiredPerBucket; // unused if max-interval semantics are chosen
}

struct Cover {
    address buyer;
    address underwriter;
    uint256 premium;
    uint256 collateral;
    EvidencePolicy[] policies;   // >1 = cross-chain condition, all must hold
    CoverStatus status;
}

enum CoverStatus { OPEN, ACTIVE, HEALTHY, CLAIMED }
```

Evidence state is tracked keyed on `(coverId, policyIndex, …)` — the final key shape follows from the semantics the spike freezes.

**Settlement:**

| Outcome | Condition | Buyer | Underwriter |
|---|---|---|---|
| `HEALTHY` | the frozen condition holds for every policy | — | collateral + premium |
| `CLAIMED` | the condition fails for any policy at the deadline | collateral | premium |

In = premium + collateral. Out = premium + collateral, both branches.

Note the inversion vs an SLA framing: here the *absence* of failure pays the underwriter. Label this explicitly in the UI or it reads backwards.

**Replay protection is scoped per cover** — keyed `(coverId, queryId)`, never on `queryId` alone. One Chainlink update is legitimately valid evidence for every cover written against that feed and window; those are independent contracts. Global consumption would be wrong here. This is a deliberate divergence from the loan-style pattern and should be documented as one.

**No `DISPUTED` state.** Deterministic on-chain evidence admits no disagreement.

---

## 5. Absence semantics

Attestcoin proves inclusion. It cannot prove absence. Nothing in this project may claim otherwise.

The contract's finding is: *insufficient valid evidence was submitted before an attestation-safe deadline.* A cover may only finalize once the ChainInfo precompile (`0x0FD3`) reports the attested height for that chain has passed `windowEndBlock`, so a lagging attestor set can never itself trigger a payout.

Incentives are self-enforcing: the underwriter profits from `HEALTHY`, so the underwriter submits proofs. Submission is permissionless, so nobody can suppress evidence to manufacture a claim.

---

## 6. Architecture

```
Chainlink aggregator (Sepolia / mainnet)
        │  emits events independently, for its own reasons
        ▼
   Proof worker (ours — no third-party relayer service exists yet)
        │  watch logs → wait for attestation frontier → build proof → submit
        ▼
   AttestableASC (Creditcoin)
        │  Block Prover 0x0FD2 → verify inclusion + continuity
        │  EvmV1Decoder → decode receipt, require status == 1, match event + emitter
        ▼
   AttestableCover (Creditcoin)
        │  ChainInfo 0x0FD3 → attestation frontier gate
        │  fill bucket → evaluate policy → settle
        ▼
   Premium / collateral move. Evidence Explorer renders the chain.
```

**The worker is a proof courier, not a decision maker.** It watches, waits, proves, submits, records. It never decides validity, never computes settlement, never approves a claim, and is never a source of truth. Every decision lives in the Creditcoin contract.

**The worker waits on the attestation frontier, never on a clock.** Wait until `latestAttestedHeight(chainKey) >= targetBlock`, then request the proof. The ~8 minutes seen in the official examples is an *observed latency*, not an architectural constant. Never hardcode it.

Two contracts, not three — the Separated Pattern from the dApp-builder docs. Verification stays small and auditable; settlement lives apart.

---

## 7. Verified environment facts

Confirmed directly by Creditcoin in Discord:

- Source chains on testnet: **chain key 1 (Sepolia), chain key 3 (Ethereum mainnet)**. Build on Creditcoin Testnet.
- **`foundry.toml` requires `bypass_prevrandao = true`** — `forge script` otherwise fails against Creditcoin Testnet on missing `prevRandao` in block headers.
- The precompile does **not** verify transaction success. Decode the receipt and require `status == 1`. Never omit.
- An **attestation dashboard** exists for viewing attestations and `verifyAndEmit` results — link to it from the Evidence Explorer. A judge confirming our proofs on Creditcoin's own dashboard is worth more than trusting our UI.
- No testnet writability during the hackathon window. Our design is read-only; unaffected.
- No prescribed pattern for latency/automation — our worker design is our own call.

To verify in the spike: RPC URL, chain ID 102031, precompile addresses `0x0FD2` / `0x0FD3`, SDK behaviour.

---

## 8. Judging — four of five pillars are not technical

Creditcoin's stated criteria: **user base expansion, technical alignment, product vision, management team quality, market fit.**

Only one is technical. Planning to date has been ~90% technical. The deck and writeup must genuinely answer the other four — see the `submission-writeup-requirements` memory. **No feature gets added unless it improves one of these five pillars or makes the Attestcoin core more convincing.**

**Open source is required, and Creditcoin explicitly asked builders not to dump everything in one commit near the deadline.** Commit per milestone, push continuously. The git history is evidence the project was genuinely built during the window — and it feeds the team-quality pillar.

---

## 9. Explicitly out of scope

Marketplace · service catalogue · watcher network of any kind · watcher staking/rewards/quorum · `DISPUTED` · credit facility or tranching · latency as a settlement condition · multi-persona dashboards · SDK/API product · AI · credit scoring · reputation · token · DAO · fake providers · fake source-chain contracts.

Some were in earlier plans. They are out. If one becomes necessary, stop and justify it before implementing.

---

## 10. Trust boundary

**Verified:** source-chain identity, source block, transaction inclusion, transaction success, event emitter, event signature, policy-required event data, evidence window, replay status, attestation state.

**Not claimed:** that Chainlink agreed to anything; that the feed is truthful; that we prove absence; that Attestcoin removes all trust; that this is a regulated insurance product.

Ship this as a **visible panel in the product**, not prose in the README. Most submissions overclaim; drawing your own boundary reads as rigor and defuses the question before it's asked.

---

## 11. Frontend — two screens plus two panels

**Coverage:** status, covered condition, premium, collateral, bucket-fill progress, provisional-vs-verified distinction, settlement result.

**Evidence Explorer:** the full chain — Ethereum → aggregator → source tx → source block → attestation → Creditcoin verification → policy evaluation → settlement. Every stage links to a real explorer, including Creditcoin's attestation dashboard.

**Proof Health panel:** source connection, latest source block, latest attested block, proof availability, last verified evidence, settlement health. Demonstrates we understand the Attestcoin architecture without a judge reading Solidity.

**Policy Transparency panel:** every policy parameter shown at purchase, with an explicit statement that they are immutable once active.

**Provisional vs verified must be visually distinct.** Off-chain observation is `PROVISIONAL — observed, awaiting attestation`. Only Creditcoin-verified evidence is `VERIFIED`, and only verified evidence is settlement input. Never blend them into one number.

---

## 12. Tests

Fewer than the competition, each demonstrable live.

1. Valid proof is recorded against the policy
2. Frozen condition satisfied by deadline → `HEALTHY`, underwriter paid
3. Frozen condition violated at deadline → `CLAIMED`, buyer paid
4. Same evidence twice, same cover → rejected
5. Same evidence across two covers → **both accepted** (deliberate, §4)
6. Evidence from a non-registered contract → rejected
7. Wrong event signature → rejected
8. Event outside the policy window → rejected
9. Failed source receipt (`status != 1`) → rejected
10. Finalization before the attestation frontier passes → rejected
11. Wrong `chainKey` → rejected
12. Unauthorized settlement / fund movement → rejected

Tests 4, 6, 7, 8, 10 double as the live attack sequence in the demo.

---

## 13. Demo — two covers, two real feeds

**Both outcomes must run on genuine, uncontrolled evidence.** Nothing staged, no service killed, no data manufactured.

The previous same-feed-two-thresholds design is **rejected**: writing a policy demanding 4 updates/hour against a feed known to deliver 1 is a guaranteed loss no rational underwriter would sign, and a sharp judge will say so. It would undercut the market-fit pillar to win a demo beat.

The spike surveys multiple Sepolia feeds looking for a reliable one (→ `HEALTHY`) and one that genuinely lapses (→ `CLAIMED`). **A natural lapse cannot be assumed and must never be manufactured** — not controlling the source evidence is one of this project's real strengths, and faking a failure would destroy it.

If no natural lapse occurs inside the recording window, fall back to a stricter tolerance on a healthy feed, labelled honestly. The wording matters:

- ✅ *"The feed remained healthy. This independently defined policy required a stricter update condition than the observed evidence satisfied."*
- ❌ *"The Chainlink feed failed."*

That distinction survives the nastiest available judge question — *"did you make the feed fail for the demo?"* — with a clean answer: **no, we don't control the source evidence and cannot influence it.**

Sequence: real Chainlink contract on Etherscan (theirs, not ours) → real events → one submitted through Attestcoin, verification shown → Creditcoin evaluates → settlement tx on Blockscout → live attack sequence (replay → rejected, wrong contract → rejected, outside window → rejected).

Account for real attestation latency. Start evidence collection well before recording; narrate over accumulated proofs with visible timestamps. Never imply the pipeline is instant.

---

## 14. Repository layout

```
README.md          Problem · Solution · Architecture · Why Creditcoin ·
                   Why Attestcoin · Security Model · Trust Boundaries ·
                   Deployment · Demo · Tests · Roadmap
contracts/         AttestableASC.sol, AttestableCover.sol, libraries/
worker/            source-monitor, proof-generator, creditcoin-submitter, config/
frontend/          coverage, evidence, components/
test/              unit/, integration/, adversarial/
```

---

## 15. Schedule — to September 6

Treat **September 6** as the deadline. A later date has been rumoured; verify on DoraHacks and treat any extension as pure buffer.

| Day | Date | Work |
|---|---|---|
| 1 | Aug 27 | **Spike.** Public repo + first commit. Resolve `aggregator()`. Identify the *actual* emitted event. Survey feeds for one reliable + one that lapses. Measure cadence and the **provable historical window**. One proof end-to-end, timed. Attempt a mainnet-chainkey proof. Fund wallets. Send the Discord question. |
| 2 | Aug 28 | Spike results freeze policy parameters and the single-vs-multi-chain call. Scaffold contracts. |
| 3 | Aug 29 | `AttestableASC` + `AttestableCover` complete, unit-tested locally. |
| 4 | Aug 30 | Worker complete. **First real settlement on testnet, end to end.** |
| 5 | Aug 31 | Tests 1–12; all rejection paths reproducible. |
| 6 | Sep 1 | Frontend: coverage, Evidence Explorer, Proof Health, Policy Transparency, trust boundary. |
| 7 | Sep 2 | Both covers run to settlement. Full dry run. |
| 8 | Sep 3 | README, technical docs, deck — **including the four non-technical pillars and the prize-spend plan.** |
| 9 | Sep 4 | Record and edit demo video. |
| 10 | Sep 5 | Buffer. Submit. |

Day 4 is the checkpoint. No settled cover on testnet by then → cut multi-chain and frontend polish immediately rather than compressing docs and video later.

---

## 16. Spike open items

1. Aggregator address behind the proxy, and whether it rotates
2. **Which event the aggregator actually emits**, and its exact field layout
3. **Independently reproduced decoding** — raw receipt → raw log → `topics[]` → event signature → indexed params → decoded event, with one real worked example preserved verbatim in the spike report. The whole product asserts "*this* external event caused *this* financial decision"; that chain of reasoning must be demonstrable by hand, not taken on a library's word. The Evidence Explorer depends on it later.
4. Real update cadence, and which timestamp is authoritative (the event's own field vs. block timestamp)
5. **How far back a block can still be proven** — the usable evidence window. Policy windows get designed inside this measured constraint, never the reverse.
6. A second feed that genuinely lapses, for the claim demo — **may not exist; do not assume one**
7. Measured end-to-end latency (source tx → settled on Creditcoin)
8. **Ethereum mainnet (chain key 3) — supported only if a full end-to-end run succeeds:** mainnet event → Attestcoin proof → Creditcoin verification → **actual Creditcoin state change**. Proof generation succeeding, an API returning 200, or the attestation dashboard showing the block do **not** qualify. Anything less means single-chain.
9. Whether multiple proofs can share one continuity proof — directly determines whether max-interval semantics are affordable
10. Creditcoin RPC + chain ID + precompiles confirmed working with Foundry (`bypass_prevrandao = true`)
11. Real submission deadline on DoraHacks

**The spike report freezes:** the evidence event and its decoding, the policy semantics in mathematical terms, the coverage window bounds, and the single-vs-multi-chain decision. Phase 2 implements exactly that and invents nothing.
