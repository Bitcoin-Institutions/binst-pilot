# Miniscript Revamp — Implementation Plan

Step-by-step plan for integrating Miniscript (BIP 379) into the BINST pilot,
replacing hand-rolled Taproot scripts with wallet-compatible spending policies,
and preparing the codebase for the WASM webapp with Bitcoin wallet support.

> **Companion document:** [MINISCRIPT.md](MINISCRIPT.md) explains the *why* and
> the architecture. This document is the *how* — ordered tasks with
> dependencies, acceptance criteria, and affected files.

---

## Scope

This revamp touches three areas:

1. **Vault layer** — replace `taproot-vault.ts` / `psbt-transfer.ts` with
   `rust-miniscript` policy compilation (new `vault` module in `binst-decoder`)
2. **Webapp layer** — expose vault descriptor generation to the browser via
   WASM; add L2 read/write capability with Bitcoin wallet connection
3. **Documentation** — update all pilot docs and the book to reflect the
   miniscript architecture and wallet UX

The Solidity contracts, inscription format, Rune design, DA proof decoding,
and value decoding are **unchanged**. This revamp is about how the Bitcoin L1
vault and the webapp interact with what already exists.

---

## Prerequisites

| Requirement | Status |
|---|---|
| Solidity contracts deployed and tested (14 tests) | ✅ Done |
| Rust taproot-reader workspace (68 tests, 4 crates) | ✅ Done |
| Human-readable value decoding (`value.rs`) | ✅ Done |
| WASM webapp scaffold (Trunk + `binst-inscription`) | ✅ Done |
| `MINISCRIPT.md` architecture document | ✅ Done |
| `rust-miniscript` crate reviewed for WASM compat | ⬜ Step 1 |

---

## Phase 1 — Vault Module (`rust-miniscript`)

**Goal:** A Rust module that generates BINST vault descriptors from keys,
compiles them to Taproot addresses, and can analyze spending conditions.
No WASM yet — pure Rust with `cargo test`.

### Step 1.1 — Add `rust-miniscript` dependency

- Add `miniscript = { version = "12", features = ["compiler"] }` to
  `taproot-reader/crates/binst-decoder/Cargo.toml`
- Verify it compiles: `cargo check -p binst-decoder`
- Verify existing 68 tests still pass: `cargo test`
- **Check WASM compatibility:** `cargo check -p binst-decoder --target wasm32-unknown-unknown`
  (if `miniscript` pulls `std`-only deps, may need feature gating — investigate now)

**Files:** `taproot-reader/crates/binst-decoder/Cargo.toml`
**Acceptance:** `cargo test` passes, dependency resolves

### Step 1.2 — Create `vault.rs` module

Create `taproot-reader/crates/binst-decoder/src/vault.rs` with:

```rust
// Core types
pub struct VaultPolicy {
    pub admin: XOnlyPublicKey,
    pub committee: [XOnlyPublicKey; 3],
    pub csv_delay: u16,          // blocks (default: 144)
}

pub struct VaultDescriptor {
    pub descriptor: String,       // tr(NUMS, {…}) string
    pub address_testnet: String,  // tb1p…
    pub address_mainnet: String,  // bc1p…
    pub spending_paths: Vec<SpendingPath>,
}

pub struct SpendingPath {
    pub name: String,             // "Admin (CSV-delayed)" / "Committee (immediate)"
    pub required_keys: Vec<String>,
    pub timelock_blocks: Option<u16>,
    pub witness_size: usize,      // worst-case vbytes
}
```

Core functions:
- `VaultPolicy::compile() -> Result<VaultDescriptor>` — compile policy to descriptor
- `VaultDescriptor::analyze() -> Vec<SpendingPath>` — enumerate spending conditions
- `VaultDescriptor::address(network) -> String` — derive address for a network

**Files:** `taproot-reader/crates/binst-decoder/src/vault.rs`, `src/lib.rs` (add `pub mod vault`)
**Acceptance:** Unit tests for descriptor generation, address derivation, path analysis

### Step 1.3 — NUMS key constant

Define the well-known unspendable NUMS point as a typed constant in `vault.rs`:

```rust
/// Provably unspendable x-only key (Ordinals NUMS point).
/// No known discrete logarithm.
const NUMS_KEY: &str = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";
```

Verify it matches the value in the existing `taproot-vault.ts` (it does — same constant).

**Files:** `vault.rs`
**Acceptance:** Constant matches `taproot-vault.ts`

### Step 1.4 — Policy compilation tests

Write tests that verify the compiled descriptor produces the same Taproot
address as the hand-rolled `taproot-vault.ts` for identical inputs:

- Test 1: Demo keys from `taproot-vault.ts` (G, K2, K3, K4) → same `tb1p…` address
- Test 2: CSV delay = 144 blocks (default)
- Test 3: CSV delay = 0 blocks (no delay — should still compile)
- Test 4: Spending path analysis returns 2 paths with correct key requirements
- Test 5: Descriptor string round-trips (`parse(format(desc)) == desc`)
- Test 6: Witness size estimates are reasonable (< 200 vbytes per path)

**Files:** `vault.rs` (inline tests)
**Acceptance:** All tests pass, address matches hand-rolled output

### Step 1.5 — Deprecation marker on `taproot-vault.ts`

Add a comment block at the top of `scripts/taproot-vault.ts`:

```typescript
/**
 * @deprecated Use the Rust vault module (binst-decoder::vault) instead.
 * This file is kept as a reference implementation and for documentation.
 * The Rust module uses rust-miniscript to generate wallet-compatible
 * descriptors from the same policy. See MINISCRIPT.md.
 */
```

**Files:** `scripts/taproot-vault.ts`, `scripts/psbt-transfer.ts`
**Acceptance:** Deprecation notices added, no functional changes

---

## Phase 2 — WASM Export

**Goal:** The vault module compiles to WASM and is callable from JavaScript
in the browser. The existing webapp gains the ability to generate vault
descriptors.

### Step 2.1 — WASM feature gate for `binst-decoder`

Add a `wasm` feature to `binst-decoder/Cargo.toml` that:
- Enables `wasm-bindgen` bindings for the vault module
- Disables any `std`-only code paths (if `miniscript` needs gating)
- Does NOT affect the CLI crate (it stays native)

```toml
[features]
default = []
wasm = ["dep:wasm-bindgen"]

[dependencies]
wasm-bindgen = { version = "0.2", optional = true }
```

**Files:** `binst-decoder/Cargo.toml`
**Acceptance:** `cargo check --target wasm32-unknown-unknown --features wasm` passes

### Step 2.2 — WASM-bindgen vault functions

Add `#[wasm_bindgen]` exports in `vault.rs` (gated behind `#[cfg(feature = "wasm")]`):

```rust
#[cfg(feature = "wasm")]
#[wasm_bindgen]
pub fn generate_vault_descriptor(
    admin_hex: &str,
    committee_a_hex: &str,
    committee_b_hex: &str,
    committee_c_hex: &str,
    csv_delay: u16,
    testnet: bool,
) -> Result<String, JsValue>  // returns JSON: { descriptor, address, paths[] }
```

The function returns a JSON string (not a complex JS object) to keep the
WASM boundary simple. JavaScript parses the JSON.

**Files:** `vault.rs`
**Acceptance:** Function compiles for `wasm32-unknown-unknown`

### Step 2.3 — Add `binst-decoder` to webapp dependencies

Update `webapp/binst-pilot-webapp/Cargo.toml`:

```toml
[dependencies]
binst-inscription = { path = "../../binst-pilot/binst-pilot/taproot-reader/crates/binst-inscription" }
binst-decoder = { path = "../../binst-pilot/binst-pilot/taproot-reader/crates/binst-decoder", features = ["wasm"] }
```

Build with Trunk: `trunk build --release`
Verify WASM size stays reasonable (target: < 500 KB).

**Files:** `webapp/binst-pilot-webapp/Cargo.toml`
**Acceptance:** `trunk build --release` succeeds, vault function callable from JS

### Step 2.4 — Vault UI in webapp

Add a "Generate Vault" panel to the webapp that:
1. Takes admin pubkey (hex input) and 3 committee pubkeys
2. Takes CSV delay (default 144, slider or input)
3. Calls `generate_vault_descriptor()` via WASM
4. Displays: descriptor string, Taproot address, spending paths in plain English
5. "Copy descriptor" button for wallet import

This is a **read-only generation tool** — it does not sign or broadcast.
The user takes the descriptor to their wallet.

**Files:** `webapp/binst-pilot-webapp/src/lib.rs`, `webapp/binst-pilot-webapp/index.html`
**Acceptance:** User can paste keys, get a descriptor and address, copy to clipboard

---

## Phase 3 — Webapp L2 Reads (Citrea)

**Goal:** The webapp can read all BINST protocol state from Citrea —
institutions, members, processes, instances, step states — without any
wallet connection.

### Step 3.1 — JavaScript L2 read layer

Add a thin JS module (loaded alongside the WASM) that uses `fetch()` to
call Citrea JSON-RPC (`eth_call`). No `ethers.js` or `viem` dependency yet —
raw `eth_call` with ABI-encoded calldata keeps the bundle small.

Functions needed (all read-only, no wallet):
- `getInstitutions(deployer)` → `address[]`
- `getInstitutionDetails(addr)` → `{ name, admin, inscriptionId, runeId, btcPubkey, memberCount }`
- `getMembers(addr)` → `address[]`
- `getProcesses(institution)` → `address[]`
- `getTemplateDetails(addr)` → `{ name, description, steps[], instanceCount }`
- `getInstances(template)` → `address[]`
- `getInstanceDetails(addr)` → `{ template, creator, currentStep, totalSteps, completed }`
- `getStepState(instance, index)` → `{ status, actor, data, timestamp }`

The ABI encoding is static (known function selectors) — no runtime ABI
parsing. Calldata is constructed with hex string concatenation.

**Files:** new `webapp/binst-pilot-webapp/citrea.js` (or inline in `index.html`)
**Acceptance:** Webapp shows a dashboard listing all institutions and their processes

### Step 3.2 — Dashboard UI

Build a read-only dashboard:
- **Institutions list** — name, admin, member count, process count, anchoring status
- **Click institution** → members, processes
- **Click process template** → steps, instances, instantiation count
- **Click instance** → step-by-step progress, actor addresses, timestamps

All data from `eth_call` — zero gas, zero wallet, zero signatures.
Configurable Citrea RPC endpoint (default: `https://rpc.testnet.citrea.xyz`).

**Files:** `webapp/binst-pilot-webapp/src/lib.rs` (DOM), `index.html`, `style.css`
**Acceptance:** Full BINST state browsable in the browser, no wallet connected

### Step 3.3 — Contract address configuration

The webapp needs to know the BINSTDeployer address to bootstrap.
Options (implement simplest first):
1. URL parameter: `?deployer=0xd0ab…aaf`
2. Text input in the UI
3. Hardcoded default for testnet (current: `0xd0abca83bd52949fcf741d6da0289c5ec7235aaf`)

The deployer address is the only seed — everything else is discovered
on-chain via `getInstitutions()` → `getProcesses()` → `getInstances()`.

**Files:** `webapp/binst-pilot-webapp/index.html`
**Acceptance:** Deployer configurable, discovery chain works

---

## Phase 4 — Bitcoin Wallet Connection + L2 Writes

**Goal:** Users connect a Bitcoin wallet (Xverse or Unisat) to sign
Citrea transactions. The same Bitcoin key that controls the inscription
UTXO also signs L2 operations — one key, one identity.

### Step 4.1 — Wallet provider detection

Bitcoin wallets inject a provider into `window`:
- **Xverse:** `window.BitcoinProvider` (Sats Connect API)
- **Unisat:** `window.unisat`

Both expose an EVM sub-provider for Bitcoin L2s (Citrea chain 5115).
Detect which is available, prompt the user to connect, obtain:
- Bitcoin address (Taproot `tb1p…` / `bc1p…`)
- Bitcoin x-only pubkey (32 bytes — this becomes the `admin` key)
- EVM address on Citrea (derived from the Bitcoin key by the wallet)

**Files:** new `webapp/binst-pilot-webapp/wallet.js`
**Acceptance:** "Connect Wallet" button, shows BTC address + EVM address after connect

### Step 4.2 — EVM transaction signing via wallet

Using the wallet's EVM provider, build and sign Citrea transactions.
For the pilot, support these write operations:

| Operation | Contract | Function |
|---|---|---|
| Create institution | `BINSTDeployer` | `createInstitution(name)` |
| Add member | `Institution` | `addMember(address)` |
| Remove member | `Institution` | `removeMember(address)` |
| Bind inscription | `Institution` | `setInscriptionId(id)` |
| Bind rune | `Institution` | `setRuneId(id)` |
| Bind BTC pubkey | `Institution` | `setBtcPubkey(bytes32)` |
| Create process | `Institution` | `createProcess(name, desc, steps…)` |
| Instantiate process | `ProcessTemplate` | `instantiate()` |
| Execute step | `ProcessInstance` | `executeStep(status, data)` |
| Transfer admin | `Institution` | `transferAdmin(newAdmin)` |

Transaction construction: ABI-encode calldata (static selectors, same as
reads), set `to`/`data`/`chainId=5115`, sign via wallet provider.

**Files:** `wallet.js` (signing), `citrea.js` (tx construction)
**Acceptance:** User can create an institution and see it appear in the dashboard

### Step 4.3 — Write UI

Add forms/modals for each write operation:
- "Create Institution" → name input → submit → show new address + link to explorer
- "Add Member" → member EVM address → submit
- "Create Process" → name, description, steps (dynamic form) → submit
- "Execute Step" → status dropdown (Complete/Reject), data JSON → submit
- "Bind Bitcoin Identity" → inscription ID, rune ID, BTC pubkey → submit

Each form:
1. ABI-encodes the calldata
2. Sends via wallet provider
3. Waits for receipt
4. Refreshes the dashboard to show the new state

**Files:** `src/lib.rs` (DOM), `index.html`, `wallet.js`
**Acceptance:** Full CRUD cycle: create institution → add member → create process → execute steps

### Step 4.4 — Wallet-aware vault generation

When the user connects their wallet, the vault generator (Phase 2) auto-fills
the admin pubkey from the connected wallet. The user only needs to provide
committee keys and CSV delay. The descriptor includes their actual key.

**Files:** `src/lib.rs`
**Acceptance:** "Generate Vault" pre-populates admin key from connected wallet

---

## Phase 5 — Documentation Updates

**Goal:** All pilot docs and the book reflect the miniscript architecture.

### Step 5.1 — Update `BITCOIN-IDENTITY.md`

In the "Script-level guard (Taproot vault)" section:
- Add a subsection explaining the miniscript representation of the vault
- Note that the descriptor string is the portable, wallet-compatible form
- Keep the raw script explanation as "under the hood" reference
- Add miniscript to the "Future enhancement with covenants" note

In the "Wallet UX" section:
- Update "Today (Phase 1-3)" to include: descriptor import workflow
- Update wallet list: add Sparrow, Nunchuk, Liana as miniscript-aware options

**Files:** `taproot-reader/BITCOIN-IDENTITY.md`

### Step 5.2 — Update `README.md`

- Add `MINISCRIPT.md` to the Documentation table
- Add `vault` module to the Taproot Reader crate table
- Update "Quick Start" with vault descriptor generation command
- Update "Scripts" table: mark `taproot-vault.ts` as deprecated reference
- Add a "Wallet Compatibility" section listing miniscript-aware wallets

**Files:** `README.md`

### Step 5.3 — Update `conceptual.md`

Add a brief section explaining that inscription UTXOs are protected by
miniscript policies — mentioning that standard Bitcoin wallets can
understand and sign for BINST vaults without custom software.

**Files:** `taproot-reader/conceptual.md`

### Step 5.4 — Update `plan.md`

Add miniscript integration to "What has been built" and update the
implementation phases to reflect the new approach.

**Files:** `plan.md`

### Step 5.5 — Update the book

Update the relevant book pages under `book/binst-pilot-docs/src/`:
- `implementation/taproot-reader.md` — vault module, rust-miniscript
- `protocol/` — wallet UX with descriptors
- `bitcoin/` — miniscript as L1 integration layer

**Files:** `book/binst-pilot-docs/src/` (multiple pages)

---

## Dependency Graph

```
Phase 1 (Rust vault module)
  │
  ├──→ Phase 2 (WASM export)
  │       │
  │       └──→ Phase 4.4 (wallet-aware vault gen)
  │
  └──→ Phase 5.1–5.4 (doc updates — can start during Phase 1)

Phase 3 (L2 reads — independent of Phase 1/2)
  │
  └──→ Phase 4 (L2 writes — needs wallet, builds on reads)
         │
         └──→ Phase 5.5 (book update — after features stable)
```

**Critical path:** Phase 1 → Phase 2 → Phase 4 (vault + WASM + wallet).
Phase 3 (L2 reads) is **independent** and can be built in parallel with Phase 1.

---

## Effort Estimates

| Phase | Scope | Est. days |
|---|---|---|
| Phase 1 | Rust vault module + tests | 2–3 |
| Phase 2 | WASM export + vault UI | 2–3 |
| Phase 3 | L2 reads + dashboard | 2–3 |
| Phase 4 | Wallet + L2 writes + write UI | 3–4 |
| Phase 5 | Documentation updates | 1–2 |
| **Total** | | **10–15** |

---

## Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| `rust-miniscript` doesn't compile to WASM | Blocks Phase 2 | Check in Step 1.1. Fallback: compile policy server-side, export descriptor string to browser |
| WASM bundle too large with `miniscript` | Slow load | Measure in Step 2.3. Fallback: lazy-load vault module, or split into separate WASM |
| Xverse/Unisat EVM provider API changes | Breaks wallet connect | Abstract behind a thin adapter in `wallet.js`. Support both providers from day one |
| Hardware wallet Taproot miniscript not yet universal | Users with unsupported HW wallets can't sign | Document supported wallets. Software wallets (Sparrow, Liana, Nunchuk) work today. HW wallet support expanding (Coldcard, Ledger confirmed) |
| `miniscript` descriptor produces different address than hand-rolled | Confusing inconsistency | Test explicitly in Step 1.4 with identical keys. If they differ, investigate leaf ordering — miniscript compiler may choose a different (but equivalent) taptree layout |

---

## Files Affected (Summary)

| File | Change |
|---|---|
| `binst-decoder/Cargo.toml` | Add `miniscript` + `wasm-bindgen` deps |
| `binst-decoder/src/lib.rs` | Add `pub mod vault` |
| `binst-decoder/src/vault.rs` | **New** — policy compilation, descriptor gen, WASM exports |
| `webapp/Cargo.toml` | Add `binst-decoder` dep with `wasm` feature |
| `webapp/src/lib.rs` | Vault UI panel, L2 dashboard, wallet connect integration |
| `webapp/index.html` | New UI sections, JS module loading |
| `webapp/style.css` | Dashboard and form styling |
| `webapp/citrea.js` | **New** — L2 read/write via JSON-RPC |
| `webapp/wallet.js` | **New** — Bitcoin wallet connection (Xverse/Unisat) |
| `scripts/taproot-vault.ts` | Deprecation notice |
| `scripts/psbt-transfer.ts` | Deprecation notice |
| `MINISCRIPT.md` | **New** — architecture document (done) |
| `miniscript_revamp.md` | **This file** — implementation plan |
| `README.md` | Add miniscript references, update crate table |
| `BITCOIN-IDENTITY.md` | Update vault section with descriptor approach |
| `conceptual.md` | Add miniscript wallet UX paragraph |
| `plan.md` | Update phases and "what has been built" |
| `book/` (multiple pages) | Reflect new architecture |

---

## Definition of Done

The revamp is complete when:

- [ ] `cargo test` in `taproot-reader/` passes with vault module tests (Phase 1)
- [ ] `trunk build --release` produces a working WASM with vault generation (Phase 2)
- [ ] Webapp shows full BINST state from Citrea without wallet (Phase 3)
- [ ] User can connect Bitcoin wallet and create an institution end-to-end (Phase 4)
- [ ] All pilot docs reference miniscript; hand-rolled scripts marked deprecated (Phase 5)
- [ ] Vault descriptor from `rust-miniscript` is importable into Sparrow or Liana
- [ ] No regressions: 14 Solidity + 68+ Rust tests passing