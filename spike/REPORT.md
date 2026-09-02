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
