# Attestable — Development Task List

Every task from step 0 to submission. This exists so you can oversee the whole build and hold me to it.

**Deadline: September 6, 2026.** Today is August 27 — **10 days**.

---

## Rules I am operating under

Restated so you never have to repeat them, and so you can point at this list if I break one.

1. **One step at a time.** No batching. Each step ends somewhere you can stand and verify something.
2. **Four-part report after every step:** what I did · how to test it right now · how it works technically · explained like you're 10.
3. **Nothing is called "working" without a transaction hash or test output proving it.** No fabricated results, ever.
4. **Answers come as code, test instructions, documentation, or a real testnet transaction** — not as claims.
5. **Build from the blockchain outward.** No significant UI work before a real proof has caused a real Creditcoin state change.
6. **If reality differs from the spec, I STOP** and give you: what was expected, what actually happened, why it matters, the options, my recommendation. Then I wait.
7. **No silent architecture changes.** Any deviation gets flagged before it's implemented.
8. **No feature is added** unless it improves one of the five judging pillars or makes the Attestcoin core more convincing.
9. **Commit per step, push continuously.** Creditcoin explicitly asked for transparent incremental history, not one dump at the end.
10. **Out of scope, permanently:** AI · watchers · credit facility · marketplace · token · DAO · reputation · credit scoring · SDK product · multi-persona dashboards · fake providers · fake source-chain contracts.
11. **Evidence design is determined empirically** — the actual emitted event and the actual provable window, measured before the policy is frozen.

**On granularity:** a "step" is one coherent testable unit, not one file write. Tightly-coupled micro-actions within a single concern are one step. Different concerns are never combined.

---

## Phase 0 — Setup

| # | Task | How you verify it | Status |
|---|---|---|---|
| 0.1 | Repo, README, SPEC, gitignore-before-keys | `git log`, `git ls-files` — `.env` absent | ✅ done |
| 0.2 | Wallets generated (deployer/buyer/underwriter from one mnemonic) | addresses on Blockscout | ✅ done |
| 0.3 | Public GitHub repo + push | github.com/Nailer/attestable loads | ✅ done |
| 0.4 | **Fund deployer with tCTC** — *your action* | I verify balance on-chain | 🔴 blocking |
| 0.5 | Toolchain: `package.json`, `foundry.toml` (`bypass_prevrandao = true`), `tsconfig`, deps | `forge build` and `npx tsc --noEmit` both exit 0 | ⬜ |

---

## Phase 1 — Technical spike

**The gate.** Nothing in Phase 2+ starts until 1.12 produces a real Creditcoin transaction. Steps 1.1–1.8 are read-only and need no funds — they can run while the faucet request is in flight.

| # | Task | How you verify it | Needs funds |
|---|---|---|---|
| 1.1 | Environment inventory (node, npm, foundry, solc versions) | printed report | no |
| 1.2 | Verify Creditcoin config against live docs — RPC, chain ID 102031, precompiles `0x0FD2`/`0x0FD3`, SDK version | RPC returns chain ID; precompiles have code | no |
| 1.3 | Resolve the real aggregator via `aggregator()` on the proxy | address printed, bytecode confirmed on Etherscan | no |
| 1.4 | **Identify the event the aggregator actually emits** — from real historical logs, not docs | sample logs with decoded topics | no |
| 1.5 | Measure real update cadence | table of intervals between updates | no |
| 1.6 | Survey other Sepolia feeds for one that genuinely lapses (for the claim demo) | comparison table of feeds and gaps | no |
| 1.7 | **Measure the provable historical window** — how far back proof generation still succeeds | success/failure at increasing block depths | no |
| 1.8 | Select a real source transaction | hash, block, receipt status — open it on Etherscan | no |
| 1.9 | Generate the first Attestcoin proof; time every stage | proof object + measured latency | no |
| 1.10 | Write `SpikeVerifier.sol` — smallest contract that verifies a proof and emits `ProofAccepted` | `forge build` succeeds | no |
| 1.11 | Deploy `SpikeVerifier` to Creditcoin testnet | contract address on Blockscout | **yes** |
| 1.12 | **🚩 GATE — submit the proof, real state change on Creditcoin** | Creditcoin tx hash + `ProofAccepted` event on Blockscout | **yes** |
| 1.13 | Test one invalid proof (wrong emitter or replay) → rejected | reverted tx you can inspect | **yes** |
| 1.14 | Mainnet chain-key 3 attempt — **timeboxed**, abandon if unreliable | works or documented failure | **yes** |
| 1.15 | Spike report → freeze policy parameters and single-vs-multi-chain decision | written report in repo | no |

---

## Phase 2 — Contracts

| # | Task | How you verify it |
|---|---|---|
| 2.1 | `AttestableASC` — proof verification, `status == 1` check, emitter + signature match | `forge test` on ASC unit tests |
| 2.2 | `AttestableCover` — policy struct, cover creation, premium + collateral escrow | tests: cover created, funds held |
| 2.3 | Bucket-fill logic (gap detection, per §4 of the spec) | tests: filling buckets, detecting gaps |
| 2.4 | Settlement — `HEALTHY` / `CLAIMED`, money moves correctly both ways | tests: both branches, balances verified |
| 2.5 | Replay protection scoped `(coverId, queryId)` | test: same evidence rejected on one cover, accepted on another |
| 2.6 | Attestation-frontier gate via `0x0FD3` | test: premature finalization rejected |
| 2.7 | Wire ASC → Cover, access control | test: only ASC can record evidence |

---

## Phase 3 — Live deployment and first real settlement

| # | Task | How you verify it |
|---|---|---|
| 3.1 | Deploy decoder library + ASC + Cover to Creditcoin, wire them together | three addresses on Blockscout |
| 3.2 | Create and fund a real cover on testnet | cover state readable on-chain |
| 3.3 | Worker: source monitor (watch aggregator logs) | logs show detected events |
| 3.4 | Worker: proof generator (attestation-frontier-driven, never a hardcoded delay) | proof produced for a detected event |
| 3.5 | Worker: submitter + record keeping | submission tx hash logged |
| 3.6 | **🚩 GATE — first full settlement end to end** | Creditcoin settlement tx; balances moved on Blockscout |

---

## Phase 4 — Adversarial tests

All twelve from SPEC.md §12. Tests 4, 6, 7, 8 and 10 double as the live attack sequence in the demo.

| # | Task | How you verify it |
|---|---|---|
| 4.1 | Happy paths (1–3): valid proof, all buckets filled, empty bucket claims | `forge test` output |
| 4.2 | Evidence integrity (4–9): replay, cross-cover, wrong contract, wrong signature, out of window, failed receipt | `forge test` output |
| 4.3 | Protocol integrity (10–12): premature finalization, wrong chain key, unauthorized settlement | `forge test` output |

---

## Phase 5 — Frontend

Only after Phase 3's gate passes.

| # | Task | How you verify it |
|---|---|---|
| 5.1 | Scaffold, connect to Creditcoin, read live contract state | real on-chain values in the browser |
| 5.2 | Coverage screen — status, condition, premium, collateral, bucket progress, settlement | matches on-chain state exactly |
| 5.3 | Evidence Explorer — full chain with real explorer links at every hop, including Creditcoin's attestation dashboard | every link opens and resolves |
| 5.4 | Proof Health panel — source connection, latest source block, latest attested block, proof availability | values match live chain data |
| 5.5 | Policy Transparency panel — all parameters, marked immutable | matches on-chain policy |
| 5.6 | Trust Boundary panel — what is verified, what is not claimed | reads correctly |
| 5.7 | Provisional vs Verified visual separation | provisional never styled as verified |

---

## Phase 6 — Demo dry run

| # | Task | How you verify it |
|---|---|---|
| 6.1 | Cover A on a reliable feed → resolves `HEALTHY` on real evidence | settlement tx |
| 6.2 | Cover B on a genuinely lapsing feed → resolves `CLAIMED` on real evidence | settlement tx |
| 6.3 | Live attack sequence runs cleanly on camera | rejected txs, inspectable |
| 6.4 | Full dry run, twice, timing the attestation waits | you watch it end to end |

---

## Phase 7 — Documentation

| # | Task | How you verify it |
|---|---|---|
| 7.1 | README final — real addresses, real tx hashes, status all green | links resolve |
| 7.2 | Technical documentation — the Attestcoin integration explained precisely (a submission requirement) | you read it |
| 7.3 | **Deck — including the four non-technical pillars**: user base expansion, product vision, team quality, market fit | you read it |
| 7.4 | **$10k prize-spend plan** — must not duplicate the CertiK audit credits winners already receive | you read it |
| 7.5 | Differentiation pass vs the competing COVENANT entry — differentiate on our strengths, never name or attack them | you read it |

---

## Phase 8 — Demo video

| # | Task | How you verify it |
|---|---|---|
| 8.1 | Script following the demo sequence | you approve before recording |
| 8.2 | Record — real attestation latency handled honestly, visible timestamps, never implying it's instant | you watch it |
| 8.3 | Edit and publish | URL works |

---

## Phase 9 — Submission

| # | Task |
|---|---|
| 9.1 | Verify the real deadline on DoraHacks |
| 9.2 | All submission fields: name, logo, sector, description, Attestcoin integration summary, GitHub URL, deck PDF, demo video URL |
| 9.3 | Team information for each member |
| 9.4 | **Submit with a day of buffer — not at 23:58** |

---

## Schedule

| Day | Date | Phases |
|---|---|---|
| 1 | Aug 27 | 0.4–0.5, Phase 1 (1.1–1.9 read-only while funding lands) |
| 2 | Aug 28 | 1.10–1.15 — **spike gate**, architecture freeze |
| 3 | Aug 29 | Phase 2 |
| 4 | Aug 30 | Phase 3 — **first real settlement gate** |
| 5 | Aug 31 | Phase 4 |
| 6 | Sep 1 | Phase 5 |
| 7 | Sep 2 | Phase 6 |
| 8 | Sep 3 | Phase 7 |
| 9 | Sep 4 | Phase 8 |
| 10 | Sep 5 | Phase 9 — submit |

---

## If we fall behind

Cut in this order. Do not compress documentation or the video — a working demo nobody can understand scores worse than a smaller demo explained well.

1. Mainnet multi-chain (1.14) — fall back to single-chain, describe multi-chain as roadmap
2. Frontend polish (5.4–5.6) — keep 5.1–5.3, they carry the demo
3. Cover B's lapsing-feed demo — fall back to a tighter tolerance on the reliable feed, stated honestly as a demonstration
4. Adversarial tests beyond the five used in the demo

**Never cut:** the spike gate, the first real settlement, the Evidence Explorer, the trust boundary, or the documentation and video.

---

## Honest risks

- **Day 4's gate is the real one.** No settled cover on testnet by end of Day 4 means cutting immediately, not compressing later.
- **Attestation latency sets a wall-clock floor** on every end-to-end test — roughly 8 minutes observed, and it applies every iteration.
- **The spike may invalidate assumptions.** If the aggregator emits an unexpected event, or the provable window is shorter than the policy needs, the policy model changes. That's exactly what the spike is for, and it's why the freeze comes after it rather than before.
- **Ten days is tight for this list.** The cut order above exists because I expect to use it.
