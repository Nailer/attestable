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
