# Phase 1 — Technical Spike Report

Living document. Each spike step appends its findings here. On completion this report **freezes** the evidence event and its decoding, the policy semantics in mathematical terms, the coverage window bounds, and the single-vs-multi-chain decision. Phase 2 implements exactly what is frozen here and invents nothing.

Started 2026-08-27.

---

## 1.1 — Environment inventory ✅

Measured on the build machine, 2026-08-27. No versions were changed.

| Component | Version |
|---|---|
| OS | macOS 15.7.4 (build 24G517), x86_64 |
| Node | v24.10.0 |
| npm | 11.6.1 |
| yarn | 1.22.22 |
| pnpm | 10.2.0 |
| forge | 1.3.5-stable (`9979a41`) |
| cast | 1.3.5-stable |
| anvil | 1.3.5-stable |
| solc (standalone) | 0.8.28 |
| git | 2.46.2 |

### Repository state

Three commits, five tracked files (`README.md`, `SPEC.md`, `TASKS.md`, `.env.example`, `.gitignore`). No `package.json`, no `foundry.toml`, no `node_modules` — the toolchain is deliberately not scaffolded yet, since Step 0.5 configures it after this inventory.

### Secret hygiene — verified

`.env` exists locally with mode `600`, is matched by `.gitignore:2`, and does **not** appear in `git ls-files`. It has never been tracked in any commit, because `.gitignore` was written before any key was generated. Confirmed with `git check-ignore -v .env`.

### Observations carried into Step 0.5

1. **Solidity version needs a deliberate choice.** The standalone compiler here is 0.8.28, but Foundry manages its own `solc` independent of that, so the standalone version is not automatically what gets used. Creditcoin's official reference repo (`gluwa/usc-testnet-bridge-examples`) pins `0.8.30` with `evm_version = "shanghai"`, and `@gluwa/usc-contracts` must compile against whatever we choose. Version is pinned in `foundry.toml` at 0.5 and verified by an actual build, not assumed.

2. **`bypass_prevrandao = true` is required** in `foundry.toml`. Confirmed directly by Creditcoin: `forge script` otherwise fails against Creditcoin Testnet because its block headers lack `prevRandao`.

3. **Package manager.** All three are available. The official reference repo uses yarn; npm is fine and is what this project will use unless a dependency forces otherwise.

### Not yet verified

Nothing in this step touched the network. Creditcoin RPC reachability, chain ID, precompile presence, and SDK behaviour are all Step 1.2 and remain unconfirmed.

---

## 0.5 — Toolchain configuration ✅ (with one finding)

### Configured

| File | Key choices |
|---|---|
| `foundry.toml` | `solc_version = "0.8.30"`, `evm_version = "shanghai"`, `libs = ["node_modules"]`, optimizer on (200 runs) |
| `package.json` | `@gluwa/usc-contracts` 0.1.2, `@gluwa/usc-sdk` 0.18.0, `@openzeppelin/contracts` 5.4.0, `ethers` 6.17.0 |
| `tsconfig.json` | ES2022, strict, `noEmit` |

Solidity 0.8.30 was chosen to match Creditcoin's official reference repo rather than the machine's standalone 0.8.28, because that pairing is already proven against `@gluwa/usc-contracts`.

### Verification performed

| Check | Result |
|---|---|
| `npm install` | 0 vulnerabilities; all four key deps resolved at requested versions |
| **Compile `EvmV1Decoder.sol` with pinned solc** | ✅ `Compiling 1 files with Solc 0.8.30 … Compiler run successful!` |
| `npx tsc --noEmit` | ✅ exit 0 |
| `@gluwa/usc-sdk` import + export surface | ✅ `proofProvider.service.ProofBuilder` and `chainInfo.PrecompileChainInfoProvider` both present |

A bare `forge build` reports "Nothing to compile" and proves nothing, so the decoder library — an actual dependency — was compiled explicitly instead. That is the check that establishes 0.8.30 is compatible with the Gluwa contracts we rely on.

### ⚠️ Finding: `bypass_prevrandao` is not recognized by forge 1.3.5-stable

Creditcoin's guidance (Q10) is to set `bypass_prevrandao = true` in `foundry.toml`, because `forge script` otherwise fails against Creditcoin Testnet on block headers lacking `prevRandao`.

**Expected:** forge accepts the key and alters its behaviour.

**Actual:** the key does not appear anywhere in `forge config` output. Only `block_prevrandao` does. Testing showed forge **silently ignores unknown keys inside `[profile.default]`** — a deliberately bogus key (`definitely_not_a_real_key = true`) produced exactly the same silent acceptance. So the absence of a warning is not evidence the setting works; it is evidence forge does not validate.

**Why it matters:** if the key is inert, `forge script` will fail against Creditcoin Testnet at deployment time (Phase 3) rather than now.

**Not blocking, because:** we do not need `forge script`. Creditcoin's own reference repo deploys with `forge create`, and the worker deploys via ethers. Both avoid the code path this setting exists to fix.

**Options:** (a) deploy with `forge create` as the reference repo does — no dependency on the setting; (b) upgrade Foundry, if the key was introduced in a later release; (c) ask Creditcoin which forge version the guidance targets.

**Recommendation:** keep the key in `foundry.toml` (harmless if inert, correct if supported), plan on `forge create` for deployment, and resolve definitively at Phase 3 rather than spending spike time on it now. The key is left in place with a comment recording that its effect is unverified.

---

## 0.4 — Funding ✅

Deployer `0x6cf450943BcCD6526Dc8168840D4eEB453463e02` holds **10,000 tCTC**, verified by `eth_getBalance` against the live RPC. Ample for deployments, many proof submissions, and demo escrow.

---

## 1.2 — Creditcoin configuration ✅

| Item | Spec said | Live chain says | |
|---|---|---|---|
| EVM chain ID | 102031 | **102031** | ✓ |
| RPC | `rpc.cc3-testnet.creditcoin.network` | reachable | ✓ |
| Client | — | `creditcoin3/v131.0/fc-rpc-2.0.0-dev` | — |

### Precompiles — `eth_getCode` is the wrong test

`eth_getCode` returns **0 bytes** for both `0x0FD2` and `0x0FD3`. This is **expected and not a fault**: these are native precompiles implemented in the node's Rust runtime, not EVM bytecode. Absence of bytecode says nothing about availability.

Verified correctly by *calling* the ChainInfo precompile through the SDK, which responded with the live supported-chain set:

| chainKey | name | native chainId | encoding |
|---|---|---|---|
| 1 | `Sepolia ethereum` | 11155111 | 1 |
| 3 | `Ethereum` | 1 | 1 |

Matches Creditcoin's Discord answer exactly. Note `chainName` returns hex-encoded bytes and needs `toUtf8String` decoding.

---

## 1.7 — Provable historical window ✅ (major result)

`getAttestationGenesisHeight` returns **0** for both chains. Verified by probing `getContinuityBounds` at increasing depths rather than trusting the number:

| Depth back from head | Block | Attested | Checkpoint span |
|---|---|---|---|
| 1 hour | 11,618,900 | ✅ | 100 |
| 1 day | 11,612,000 | ✅ | 100 |
| 1 week | 11,568,800 | ✅ | 100 |
| 1 month | 11,403,200 | ✅ | 100 |
| 6 months | 10,323,200 | ✅ | 1,000 |
| 1 year | 9,027,200 | ✅ | 1,000 |
| genesis+1 | 1 | ✅ | 1,000 |

**The entire chain history is provable, back to block 1.** There is no recency constraint on the evidence window.

Checkpoint spacing is 100 blocks for recent history and 1,000 for older — older evidence implies longer continuity proofs and therefore more gas, but remains valid.

**Attestation lag, measured:** Sepolia 36 blocks (~7.2 min), Ethereum mainnet 38 blocks (~7.6 min). This confirms the ~8 minute figure from Creditcoin's examples empirically. **Mainnet is being attested actively**, which is promising for 1.14.

### Why this matters more than expected

Because all history is provable, a coverage window can be placed over a *past* period whose evidence already exists. That removes the dependency on a lapse happening during the recording window — see 1.6.

---

## 1.3 — The real evidence emitter ✅

| | |
|---|---|
| Proxy | `0x694AA1769357215DE4FAC081bf1f309aDC325306` |
| `description()` | `ETH / USD` |
| `decimals()` | 8 |
| **Aggregator (real emitter)** | **`0x719E22E3D4b690E5d96cCb40619180B5427F14AE`** |

**The trap is confirmed empirically.** Over a 24-hour window: the aggregator emitted **81 logs**; the proxy emitted **0**. Filtering on the proxy address returns nothing. The policy must bind to the aggregator.

---

## 1.4 — Which event is actually emitted ✅

Rather than assuming `AnswerUpdated`, all observed `topic0` values were matched against a candidate set. Over 24 hours the aggregator emitted three events, **27 of each** — they fire together on every update:

| topic0 | Event | Count |
|---|---|---|
| `0x0559884f…46fc5f` | `AnswerUpdated(int256,uint256,uint256)` | 27 |
| `0xf6a97944…23d451` | `NewTransmission(uint32,int192,address,int192[],bytes,bytes32)` | 27 |
| `0x0109fc6f…c60271` | `NewRound(uint256,address,uint256)` | 27 |

**`AnswerUpdated` is present and usable.** The OCR2 concern raised before the spike was legitimate — this is an OCR aggregator emitting `NewTransmission` — but it also emits the legacy `AnswerUpdated`, which is the simplest to decode (one indexed `roundId`, `int256 answer` and `uint256 updatedAt` in data).

**Selected evidence event:** `AnswerUpdated(int256,uint256,uint256)`, topic0 `0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f`, emitted by `0x719E22E3D4b690E5d96cCb40619180B5427F14AE`.

---

## 1.5 — Real update cadence ✅

Measured over ~24 hours (27 updates):

| | |
|---|---|
| min gap | 7.0 min |
| median gap | 60.4 min |
| **max gap** | **61.4 min** |
| mean gap | 55.5 min |

Distribution: mostly 60–61 min with occasional early updates (7, 32, 38, 51, 53, 55, 56 min) — a **3600 s heartbeat with deviation-triggered early updates**.

### ⚠️ Design consequence — the nominal heartbeat is an unsafe tolerance

The heartbeat is nominally 3600 s, but real gaps reach **61.4 minutes**, because the heartbeat fires *after* 3600 s elapse plus block time. **A policy with a 60-minute tolerance would register a violation against a perfectly healthy feed.** Any tolerance must carry headroom above the observed maximum — 90 minutes is a defensible choice against a measured 61.4-minute worst case.

---

## 1.6 — Feed survey ✅ (and a better answer than expected)

Twelve Sepolia feeds probed over ~3 days:

| Feed | Updates | Median gap | Max gap |
|---|---|---|---|
| ETH/USD | 38 | 60m | **667m** |
| BTC/USD | 36 | 61m | 606m |
| LINK/USD | 41 | 61m | 712m |
| BTC/ETH | 36 | 61m | 605m |
| SNX/USD | 49 | 60m | 608m |
| XAU/USD | 51 | 58m | 580m |
| FORTH/USD | 421 | 2m | 725m |
| USDC/USD | 3 | 1441m | 1441m |
| DAI/USD | 2 | 1440m | 1440m |
| GBP/USD | 2 | 1440m | 1440m |
| EUR/USD, JPY/USD | 1 | — | too few |

### The large gaps are real — verified, not assumed

Many feeds showing similar ~600-minute maxima looked like it could be an artifact of silently-failed RPC chunks. Re-scanned with error suppression removed:

- **0 chunks failed** — the scan was complete
- Blocks *were* being produced throughout each gap (midpoint blocks exist with valid timestamps), so the chain was live and **the feed genuinely did not update**

Three real lapses on ETH/USD:

| Gap | From | To |
|---|---|---|
| 215.0 min | 2026-08-30 21:02 UTC (block 11,601,307) | 2026-08-31 00:37 UTC (block 11,602,342) |
| **773.6 min** | 2026-08-31 00:37 UTC (block 11,602,342) | 2026-08-31 13:30 UTC (block 11,605,987) |
| 667.2 min | 2026-08-31 13:30 UTC (block 11,605,987) | 2026-09-01 00:37 UTC (block 11,609,235) |

### Consequence: no second feed is needed

ETH/USD alone gives **both** demo outcomes on genuine, uncontrolled evidence:

- **HEALTHY** — a window over a steady period, tolerance 90 min, real max gap 61.4 min
- **CLAIMED** — a window over 2026-08-31, containing a genuine **12.9-hour** lapse

Both use the same real feed, the same pipeline, and evidence nobody manufactured or influenced. The earlier worry — "what if no lapse happens during recording?" — is resolved by 1.7: all history is provable, and a real lapse already exists in it.

**Framing requirement:** the CLAIMED demo settles over a *historical* window whose outcome is already determined. That must be stated plainly — it demonstrates settlement against real past evidence; production covers are written forward over unknown outcomes.

---

## Policy semantics — frozen

With cadence measured, the §4 decision resolves:

**Max-interval semantics are affordable, so correctness wins.** At ~27 updates per 24 h, a one-day window needs ~27 proofs; a 6-hour window needs ~7. Bucket occupancy — which only approximates a staleness guarantee — is not needed.

> **FROZEN:** a cover is `CLAIMED` if the interval between any two consecutive verified `AnswerUpdated` events inside the policy window exceeds `toleranceSecs`, or if the interval between the window boundary and its adjacent event does. Otherwise `HEALTHY`.
>
> - Evidence event: `AnswerUpdated(int256,uint256,uint256)`
> - Emitter: `0x719E22E3D4b690E5d96cCb40619180B5427F14AE` (aggregator, never the proxy)
> - Timestamp source: **to be confirmed** — the event's own `updatedAt` field vs. block timestamp (see open items)
> - Tolerance: must exceed the measured 61.4 min maximum; 90 min recommended

---

---

## 1.8 — Selected evidence transaction ✅

Chosen from within the attested range, so it is provable immediately.

| Field | Value |
|---|---|
| tx hash | `0x797c7f9b606e8c193cda0842ef891d5cf6c7180d88c2ea975360fafec9b89f46` |
| block number | 11,621,136 |
| block hash | `0x3fc78584f77dfcdd219edead3cd3d55d09ce805537c8f6298374e3a087730713` |
| block timestamp | 1788371340 — 2026-09-02T17:49:00Z |
| log index | 29 |
| emitter | `0x719E22E3D4b690E5d96cCb40619180B5427F14AE` (aggregator) |
| **receipt status** | **1 (success)** |
| tx `from` | `0xB4fC80AEc34911C5d761259E74aE8a24c2C5D995` — gas payer only, never bound to policy |
| logs in tx | 3 |

Verify independently: `https://sepolia.etherscan.io/tx/0x797c7f9b606e8c193cda0842ef891d5cf6c7180d88c2ea975360fafec9b89f46`

---

## 1.8A — Hand-decoded evidence ⚠️ (found a real error)

### The raw log, verbatim

```
address  : 0x719E22E3D4b690E5d96cCb40619180B5427F14AE
topics[0]: 0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f
topics[1]: 0x00000000000000000000000000000000000000000000000000000037a9fafec0
topics[2]: 0x0000000000000000000000000000000000000000000000000000000000008b97
data     : 0x000000000000000000000000000000000000000000000000000000006a98618c
```

### ⚠️ The ABI layout assumed in earlier revisions of this spec was WRONG

Prior revisions assumed `AnswerUpdated(int256 current, uint256 indexed roundId, uint256 updatedAt)` — one indexed parameter, two data words.

The raw log shows **3 topics and 1 data word**, meaning **two** parameters are indexed. The true declaration is:

```solidity
event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt)
```

**Why this is dangerous and why it was nearly missed:** a Solidity event's signature hash is computed from parameter *types* only — indexing does not affect it. So `topic0` matched perfectly against the wrong assumption. Every signature check would have passed while the decoder silently read the price out of the wrong location. This class of bug does not announce itself.

This is precisely the failure mode step 1.8A was added to catch, and it caught it on the first real log.

### Decoding, step by step

| Step | Source | Value |
|---|---|---|
| signature | `topics[0]` | matches `keccak256("AnswerUpdated(int256,uint256,uint256)")` ✓ |
| `int256 indexed current` | `topics[1]` | 239075000000 → **$2390.75** (8 decimals) |
| `uint256 indexed roundId` | `topics[2]` | 35735 |
| `uint256 updatedAt` | `data` word 0 | 1788371340 → 2026-09-02T17:49:00Z |

**Cross-checks, both passed:**
- Hand-decoded values match `ethers.Interface.parseLog` exactly under the corrected layout
- Decoded price $2390.75 equals the live feed's current `latestRoundData()` answer — confirming a real price was decoded, not misaligned bytes

### Timestamp question — resolved

`updatedAt` (1788371340) and the block timestamp (1788371340) were **identical**, drift 0 s.

**Decision: use the event's own `updatedAt`.** It sits inside the log data covered by the receipt proof, so it is verified by the same proof as everything else. The block timestamp is a header field the receipt proof does not cover, and relying on it would add a trust assumption for no gain.

---

## Frozen evidence definition

```solidity
// Source chain: Ethereum Sepolia, chainKey 1
address constant AGGREGATOR = 0x719E22E3D4b690E5d96cCb40619180B5427F14AE;

// keccak256("AnswerUpdated(int256,uint256,uint256)")
bytes32 constant ANSWER_UPDATED =
    0x0559884fd3a460db3073b7fc896cc77986f16e378210ded43186175bf646fc5f;

// LAYOUT (verified against real logs, not assumed):
//   topics[0] = ANSWER_UPDATED
//   topics[1] = int256  indexed current    (price, 8 decimals)
//   topics[2] = uint256 indexed roundId
//   data[0]   = uint256 updatedAt          <- authoritative timestamp
// Requires topics.length == 3 and data.length == 32.
```

Contracts must assert `topics.length == 3` and `data.length == 32`. Those assertions are what stop a differently-shaped lookalike event from being accepted.

---

## Open items after 1.8A

Steps 1.9–1.15 remain: proof generation and timing, the minimal verifier contract, deployment, on-chain verification (the gate), invalid-proof rejection, and the mainnet attempt.

---

## 1.9 — First real proof generated ✅

Proof requested for the selected evidence transaction. The block was already past the attestation frontier, so no waiting was required.

| Stage | Elapsed |
|---|---|
| check attestation frontier | 0.01 s |
| `waitUntilHeightAttested` (returned immediately — already attested) | 12.24 s |
| `getProof` | 13.96 s |
| **total** | **15.44 s** |

Note: the 12 s in `waitUntilHeightAttested` is SDK polling overhead on an already-satisfied condition, not real waiting. For a *fresh* transaction, add the measured ~7.2 min attestation lag from 1.7.

### Proof contents

| Field | Value |
|---|---|
| chainKey | 1 |
| headerNumber | 11,621,136 |
| txIndex | 45 |
| txBytes | 3,168 bytes (encoded transaction + receipt) |
| merkle root | `0xd9c5259c69e12174e99b6e9764e0397a540745b05b400a6b3ae7944bd7c0bc3d` |
| merkle siblings | 7 |
| **continuity roots** | **65** |
| served from cache | true |

Returned `txHash` matches the requested hash. Full proof saved at `spike/proof-sample.json`.

**Gas implication:** continuity roots dominate cost. Using the reference implementation's fallback estimate (`21000 + roots*5000 + 20000`), 65 roots implies roughly **366,000 gas** per submission. The root count grows with distance from the nearest attestation checkpoint, so evidence near a checkpoint is cheaper to prove.

---

## Spike item 9 — batch proofs share one continuity proof ✅

`getBatchProof(txHashes[])` returns a fundamentally different shape from single proofs:

```
{ chainKey, fromHeader, toHeader, continuityProof, merkleProofs, cached, generatedAt }
```

**One `continuityProof` for the whole batch, with a map of per-transaction `merkleProofs`.**

This is a decisive economic result. Proving N transactions costs one continuity proof plus N merkle proofs, rather than N continuity proofs. Since the 65 continuity roots dominate gas, batching turns the per-proof marginal cost from ~366k gas into something far smaller.

**This validates the max-interval policy semantics frozen earlier.** Proving every update across a coverage window — roughly 27 for a 24-hour window — was the affordability concern that made bucket occupancy tempting. Batch proofs remove that concern, so the correct semantics are also the affordable ones.

`fromHeader` and `toHeader` in the batch response indicate a block *range*, which fits an evidence window directly.

---

## 1.10 — SpikeVerifier contract ✅

First real Solidity. Two files:

- `contracts/interfaces/INativeQueryVerifier.sol` — binding to the Block Prover precompile at `0x0FD2`
- `contracts/spike/SpikeVerifier.sol` — minimal contract proving the pipeline

Deliberately throwaway. No escrow, no policy, no settlement — those are Phase 2. Its only purpose is to make step 1.12's gate meaningful: real evidence causing a real Creditcoin state change.

### The six checks, in order

| # | Check | Why it exists |
|---|---|---|
| 1 | `chainKey == EXPECTED_CHAIN_KEY` | evidence must come from the source chain we cover |
| 2 | query not already consumed | replay protection |
| 3 | `verifyAndEmit` returns true | the Attestcoin guarantee — inclusion + continuity |
| 4 | `receiptStatus == 1` | **the precompile does not check success.** A reverted transaction is still genuinely included in its block |
| 5 | `log.address_ == EXPECTED_EMITTER` | anyone can deploy a contract emitting a lookalike event and prove it honestly. The proof would be valid; the evidence worthless |
| 6 | `topics.length == 3 && data.length == 32` | pins the parameter layout. The signature hash is identical whether or not parameters are indexed, so check 6 — not the hash — is what actually establishes shape |

Checks 4, 5 and 6 each defend against a distinct way that a *cryptographically valid* proof can still carry *useless* evidence. That distinction is the core of the security model.

### Compilation findings

**`pure` → `view`.** Reading the `EXPECTED_EMITTER` immutable makes the decode helper `view`. Immutables are read from code, but Solidity still requires `view`.

**Stack too deep.** The original `ProofAccepted` event carried `chainKey` and `emitter` alongside seven function parameters, exceeding the EVM's 16-slot stack limit. Resolved without `via_ir` by dropping both from the event — they are immutables already readable from the contract — and scoping the proof structs so they leave the stack before decoding.

**Library linking required.** The compiled bytecode contains an unlinked placeholder `__$8c2f7f74ada027f7cf16d7777e2642b278$__`. `EvmV1Decoder` exposes `public` functions, so it is a deployed library, not inlined code. Step 1.11 must therefore deploy the decoder **first**, then deploy `SpikeVerifier` with `--libraries` pointing at it — matching the reference repo's documented flow.

### Compiled artefacts

| | |
|---|---|
| solc | 0.8.30, optimizer on (200 runs) |
| creation bytecode | 5,041 bytes (limit 24,576) |
| constructor | `(address expectedEmitter, uint64 expectedChainKey)` |
| entry point | `submitEvidence(uint64,uint64,bytes,bytes32,tuple[],bytes32,bytes32[])` |

Typed errors (`WrongEmitter`, `SourceTransactionFailed`, `MalformedEvent`, `AlreadyConsumed`, …) rather than string reverts, so step 1.13's rejection tests can assert *which* check fired rather than merely that something failed.

---

## 1.11 — Deployed to Creditcoin testnet ✅

Deployed with `forge create`, avoiding `forge script` entirely — which sidesteps the unresolved `bypass_prevrandao` question from 0.5. Two deployments were required because `EvmV1Decoder` exposes `public` functions and is therefore a linked library, not inlined code.

| Contract | Address | Deploy tx |
|---|---|---|
| `EvmV1Decoder` (library) | `0x843e8432dfE39e2010511796e7e37fC44EAb72d3` | `0xce72bdf4a37decb3e58c3ecee939f153a3cf87c03690f51bf128c5e3af5aca54` |
| `SpikeVerifier` | `0x38817EdCa801DeeC79Dbe586Af26a1D04D180248` | `0xf503fbea5d41a1a554b706d101c559e6ef93ed5435fc6fedf8c775ee77a03e57` |

Constructor arguments: `expectedEmitter = 0x719E22E3D4b690E5d96cCb40619180B5427F14AE`, `expectedChainKey = 1`.

### Verified by reading the chain, not by trusting the deploy output

| Call | Result |
|---|---|
| `eth_getCode` | 4,797 bytes present |
| `EXPECTED_EMITTER()` | `0x719E22E3D4b690E5d96cCb40619180B5427F14AE` ✓ matches the aggregator resolved in 1.3 |
| `EXPECTED_CHAIN_KEY()` | `1` ✓ Sepolia |
| `ANSWER_UPDATED()` | `0x0559884f…46fc5f` ✓ matches the topic0 observed in real logs |
| `acceptedCount()` | `0` — nothing accepted yet, as expected before the gate |

**Cost:** both deployments together consumed **0.006 tCTC**, leaving 9,999.994. Gas is not a constraint on this testnet.

Explorer: `https://creditcoin-testnet.blockscout.com/address/0x38817EdCa801DeeC79Dbe586Af26a1D04D180248`

`acceptedCount() == 0` is the pre-condition for step 1.12. When it reads `1`, the pipeline has been proven end to end.
