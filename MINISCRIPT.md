# Miniscript Integration — BINST Vault Architecture

How BINST uses [Miniscript](https://bitcoin.sipa.be/miniscript/) (BIP 379)
to replace hand-rolled Taproot scripts with portable, wallet-compatible
spending policies for inscription UTXO protection.

---

## Why Miniscript

The pilot's `taproot-vault.ts` hand-builds Tapscript leaf scripts, computes
taptree hashes, and constructs control blocks manually (~300 lines). This
works but creates three problems:

1. **No wallet interop.** Standard Bitcoin wallets cannot sign for a custom
   script they don't understand. Users must use `bitcoin-cli` or bespoke
   tooling to spend from the vault.
2. **No automatic analysis.** Given a vault script, there is no generic way
   to determine what conditions are needed to spend, estimate fees, or
   verify correctness — each script layout requires custom code.
3. **No composability.** Adding a new spending path (e.g., a timelock
   escalation, a 4th committee key) requires rewriting the script builder.

Miniscript solves all three. It is a structured subset of Bitcoin Script
designed for Tapscript (BIP 342) that enables:

- **Automatic signing** — any miniscript-aware wallet (Nunchuk, Sparrow,
  Liana, Bitcoin Core) can sign without custom firmware or plugins
- **Static analysis** — spending conditions, witness sizes, and fee
  estimates are computed from the policy, not from inspecting raw opcodes
- **Composition** — policies combine with `and()`, `or()`, `thresh()`;
  the compiler finds the optimal Taproot tree automatically
- **Hardware wallet support** — Coldcard and Ledger sign Taproot
  miniscript natively (as of 2025)

---

## Current Vault → Miniscript Vault

### Before (hand-rolled in `taproot-vault.ts`)

```
Taproot output:
  Internal key: NUMS (unspendable)
  Leaf 0: <admin_pk> OP_CHECKSIG <144> OP_CSV OP_DROP
  Leaf 1: <A> OP_CHECKSIG <B> OP_CHECKSIGADD <C> OP_CHECKSIGADD <2> OP_NUMEQUAL
```

### After (miniscript policy)

```
or(
  and(pk(admin), older(144)),
  multi_a(2, committeeA, committeeB, committeeC)
)
```

The miniscript compiler produces the same Taproot tree — optimal leaf
scripts, merkle root, tweaked output key, and control blocks — but the
result is a **standard descriptor** any compatible wallet can import:

```
tr(NUMS, {and_v(v:pk(ADMIN), older(144)), multi_a(2, A, B, C)})
```

### What the user sees

| Without miniscript | With miniscript |
|---|---|
| Raw hex scripts, manual PSBT | Import descriptor into wallet |
| `bitcoin-cli` signing flow | Wallet shows: "Admin + 24h delay OR 2-of-3 committee" |
| Custom fee estimation | Wallet auto-computes worst-case witness size |
| Hardware wallets can't sign | Coldcard / Ledger sign natively |

---

## Institutional Policy Patterns

Miniscript enables policy patterns beyond the basic vault that would be
impractical to hand-roll. These are future extensions, not pilot scope,
but the architecture supports them from day one.

### Decaying multisig (key-loss recovery)

```
thresh(3, pk(A), pk(B), pk(C), older(12960), older(25920))
```

3-of-3 normally → 2-of-3 after 90 days → 1-of-3 after 180 days.
Prevents permanent lockout from key loss.

### Process step escrow

```
or(
  and(pk(payer), pk(executor)),
  and(pk(payer), older(1008))
)
```

Released when both parties sign; refunded to payer after ~7 days.

### Role-based treasury

```
or(
  99@pk(admin),
  and(multi_a(2, boardA, boardB, boardC), older(4320))
)
```

Admin can spend immediately (hot path). Board 2-of-3 after 30 days
(cold path). Probabilities hint the compiler to optimize for the
common case.

---

## Implementation: `rust-miniscript` in WASM

The [`rust-miniscript`](https://github.com/rust-bitcoin/rust-miniscript)
crate provides everything needed and compiles to WASM:

- **Policy compilation** — `policy::Concrete` → optimal Tapscript tree
- **Descriptor generation** — `Descriptor::new_tr()` with the compiled
  tree and NUMS internal key
- **Address derivation** — descriptor → `tb1p…` / `bc1p…` address
- **PSBT finalization** — given a descriptor and signatures, produce the
  minimal valid witness
- **Spending analysis** — enumerate all spending paths with required
  keys, timelocks, and witness sizes

### Crate integration

Add to the `taproot-reader` workspace:

```toml
[dependencies]
miniscript = { version = "12", features = ["compiler"] }
```

### Core API (new `vault` module in `binst-decoder`)

```rust
use miniscript::policy::Concrete;
use miniscript::descriptor::Tr;

/// Generate a BINST vault descriptor from institutional keys.
pub fn vault_descriptor(
    admin_pk: XOnlyPublicKey,
    committee: [XOnlyPublicKey; 3],
    csv_delay: u16,
) -> Tr<XOnlyPublicKey> {
    let policy = Concrete::Or(vec![
        (1, Concrete::And(vec![
            Concrete::Key(admin_pk),
            Concrete::Older(Sequence::from_height(csv_delay)),
        ])),
        (1, Concrete::Multi(2, committee.to_vec())),
    ]);
    let tree = policy.compile_tr(NUMS_KEY).unwrap();
    tree
}
```

The webapp calls this via `wasm-bindgen`:

```rust
#[wasm_bindgen]
pub fn generate_vault_descriptor(
    admin_hex: &str,
    committee_a_hex: &str,
    committee_b_hex: &str,
    committee_c_hex: &str,
    csv_delay: u16,
) -> String {
    // parse keys, call vault_descriptor(), return descriptor string
    format!("{}", descriptor)
}
```

The descriptor string is what the user imports into their wallet.

---

## Wallet UX Flow

```
1. User creates institution in BINST webapp
   → webapp generates miniscript policy from user's keys
   → compiles to Taproot descriptor string
   → shows: "Your vault policy: Admin + 144-block delay OR 2-of-3 committee"

2. User exports descriptor to their Bitcoin wallet
   → Sparrow: File → Import → Descriptor
   → Nunchuk: Add wallet → Custom miniscript
   → Liana: supports miniscript natively (designed for it)
   → Bitcoin Core: importdescriptors '[{"desc":"tr(…)"}]'

3. Wallet generates receive address (tb1p… / bc1p…)
   → user inscribes institution to that address
   → inscription UTXO is script-guarded from creation

4. When admin needs to move inscription (transfer, reinscribe)
   → wallet creates PSBT (knows the policy, knows what to sign)
   → admin signs → wallet finalizes → broadcast
   → no bitcoin-cli, no custom tooling

5. Emergency: committee override
   → 2 of 3 committee members sign in their wallets
   → wallet handles OP_CHECKSIGADD witness automatically
```

**Friction reduction:** users never see raw hex, never run CLI commands,
never construct witnesses manually. They import a descriptor and their
wallet handles the rest.

---

## What Miniscript Does NOT Cover

| Concern | Miniscript role | Still needed |
|---|---|---|
| Inscription commit/reveal | Not involved — standard P2TR key-path | `ord` CLI or Xverse/Unisat inscription API |
| L2 contract interaction | Not involved — EVM signing | Bitcoin wallet's EVM provider (Xverse/Unisat) |
| Rune operations | Not involved — standard Runestone | `ord` CLI or wallet Rune support |
| Covenant enforcement | Future — when OP_CTV/OP_CAT activate | Miniscript will likely be extended for covenants |

Miniscript applies specifically to **spending conditions on inscription
UTXOs** — the vault that protects institutional identity. Everything else
in the protocol (L2 writes, inscriptions, Runes) uses standard mechanisms.

---

## Relationship to Existing Code

| Current file | What happens |
|---|---|
| `scripts/taproot-vault.ts` | **Replaced** by `rust-miniscript` policy compilation. Kept as reference/documentation. |
| `scripts/psbt-transfer.ts` | **Simplified** — wallet handles PSBT construction from descriptor. Script becomes optional for advanced users. |
| `scripts/inscribe-binst.ts` | **Unchanged** — inscription creation is orthogonal to vault policy. `--destination` flag points to the vault address. |
| `taproot-reader/crates/binst-decoder` | **Extended** — new `vault` module with policy generation and descriptor export. |
| `webapp/binst-pilot-webapp` | **Extended** — WASM-exported `generate_vault_descriptor()` for browser use. |

---

## References

- [BIP 379 — Miniscript](https://github.com/bitcoin/bips/blob/master/bip-0379.md)
- [Miniscript interactive demo](https://bitcoin.sipa.be/miniscript/) (Pieter Wuille)
- [rust-miniscript](https://github.com/rust-bitcoin/rust-miniscript) — Rust implementation (CC0 license)
- [Bitcoin Optech — Miniscript topic](https://bitcoinops.org/en/topics/miniscript/)
- [Nunchuk Miniscript support](https://bitcoinmagazine.com/technical/nunchuck-wallet-brings-programmable-bitcoin-to-everyone-with-miniscript-support) (Aug 2025)
- [Liana wallet](https://wizardsardine.com/liana/) — miniscript-native Bitcoin wallet
- [Nunchuk Miniscript 101](https://nunchuk.io/blog/miniscript101) — technical guide