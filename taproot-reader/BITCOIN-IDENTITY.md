# BINST Bitcoin-Native Identity Architecture

How BINST entities are represented, discovered, and verified on Bitcoin.

---

## Overview

BINST uses three Bitcoin-native primitives to make institutional entities
fully stored and reachable on Bitcoin, with Citrea as the processing layer:

| Primitive | Role | What it represents |
|---|---|---|
| **Ordinals inscriptions** | Entity identity, ownership, metadata | Institutions, process templates, process instances |
| **Runes** | Membership and fungible roles | "Alice is a member of Acme Financial" |
| **Citrea ZK batch proofs** | Computational verification | Step execution, payments, state transitions — proven correct |

```
Bitcoin L1
├── Ordinals    → entities EXIST here (identity, ownership, metadata)
├── Runes       → membership IS here (fungible tokens per institution)
└── ZK proofs   → computation is PROVEN here (Citrea batch proofs)

Citrea L2
└── Solidity    → complex logic EXECUTES here, then gets proven to Bitcoin
```

---

## Ordinals — entity identity and provenance

Each BINST entity is a permanent **Ordinals inscription on Bitcoin**.
The inscription is the entity's birth certificate, identity anchor, and
metadata carrier.

### Provenance hierarchy

Entities form a parent/child tree rooted at a single BINST root inscription:

```
BINST Root Inscription (parent)
 ├── Institution "Acme Financial" (child)
 │    ├── Process Template "KYC Onboarding" (grandchild)
 │    │    ├── Instance #1 (great-grandchild)
 │    │    │    ├── Step 1 executed by Alice (event)
 │    │    │    └── Step 2 executed by Bob (event)
 │    │    └── Instance #2
 │    └── Process Template "Loan Approval"
 └── Institution "Bitcoin Credit Union" (child)
```

Anyone running `ord` can verify the full provenance chain — "KYC Onboarding
was created by Acme Financial" — without touching Citrea.

### Inscription format

Every BINST inscription uses:
- **Metaprotocol** (tag 7) = `"binst"` — filterable by any indexer
- **Content type** = `application/json`
- **Metadata** (tag 5) = CBOR-encoded structured data
- **Parent** (tag 3) = parent inscription ID (provenance chain)

Example institution inscription:

```
OP_FALSE OP_IF
  OP_PUSH "ord"
  OP_PUSH 1                              ← content type tag
  OP_PUSH "application/json"             ← MIME type
  OP_PUSH 7                              ← metaprotocol tag
  OP_PUSH "binst"                        ← protocol identifier
  OP_PUSH 5                              ← metadata tag
  OP_PUSH <CBOR-encoded metadata>        ← structured metadata
  OP_PUSH 3                              ← parent tag
  OP_PUSH <binst-root-inscription-id>    ← provenance chain
  OP_PUSH 0                              ← body separator
  OP_PUSH '{
    "type": "institution",
    "name": "Acme Financial",
    "admin_btc_pubkey": "a3f4...x-only-32-bytes",
    "citrea_contract": "0x1234...5678",
    "created_btc_height": 127600,
    "members": ["pubkey1...", "pubkey2..."]
  }'
OP_ENDIF
```

### Ownership

The inscription UTXO is controlled by the admin's Bitcoin key. Transfer
the UTXO = transfer admin rights. A Bitcoin maximalist holds their
institution in their Bitcoin wallet.

### Updates via reinscription

The first inscription is canonical (per Ordinals protocol). Reinscriptions
**append** to the history — they do not overwrite. This is ideal for BINST:

- Inscription 1 (canonical): "Created Acme Financial, admin=pk1"
- Reinscription 2: "Updated description"
- Reinscription 3: "Admin transferred to pk2"

Institutions cannot erase their history. The append-only model matches
the transparency requirement.

Ownership transfer is a UTXO transfer, not a reinscription. The inscription
ID stays the same; the controlling key changes.

### Discovery

BINST inscriptions are discoverable through standard tooling:
- Ordinals explorers (ordinals.com, ord.io, Hiro) — search by metaprotocol
- Ordinals wallets (Xverse, Unisat) — shows as an asset
- Self-hosted `ord` indexer — trustless, complete access
- **No custom BINST software needed for basic discovery**

---

## Runes — membership tokens

Each institution etches a **Rune** that represents membership.

```
Rune: ACME•MEMBER
  Divisibility: 0  (whole units only — member or not)
  Symbol: 🏛
  Premine: 1  (admin gets the first unit)
  Terms: cap=1000, amount=1 (admin mints and distributes)
```

### How membership works

- **Check:** "Is Alice a member?" → "Does Alice hold ≥1 `ACME•MEMBER`?"
  Standard Rune indexer query. No Citrea needed.
- **Add:** Admin sends 1 unit to new member's Bitcoin address.
- **Remove:** Admin burns the token via edict, or member sends it back.
- **Visible:** Members see membership in any Rune-aware wallet.

This mirrors the Solidity `addMember`/`removeMember` pattern but lives
entirely on Bitcoin L1.

### Future: governance tokens

A separate Rune (e.g., `ACME•VOTE`) with divisibility could represent
weighted voting power. Governance becomes a token distribution problem.

---

## Citrea — processing layer and ZK verification

Complex institutional logic executes on Citrea's smart contracts:
- Multi-step workflow execution with validation rules
- Payment processing
- Cross-contract calls and event emission
- State management (current step, completion, timestamps)

Citrea periodically writes **ZK batch proofs** to Bitcoin — mathematical
guarantees that every state transition was computed correctly. This is the
strongest verification layer: anyone with a Bitcoin full node and the
`taproot-reader` tool can independently verify correctness without
trusting Citrea.

See `DECODING.md` for the technical format of batch proofs and
sequencer commitments.

---

## Architecture diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    BITCOIN (L1)                              │
│                                                             │
│  ┌───────────────────────┐    ┌──────────────────────────┐  │
│  │   ORDINAL INSCRIPTIONS │    │        RUNES             │  │
│  │   (Identity Layer)     │    │   (Membership Layer)     │  │
│  │                        │    │                          │  │
│  │  Root: "binst" proto   │    │  ACME•MEMBER (fungible)  │  │
│  │   └─ Institution       │    │  BCU•MEMBER              │  │
│  │       └─ Template      │    │  ACME•VOTE (governance)  │  │
│  │           └─ Instance  │    │                          │  │
│  │               └─ Event │    │                          │  │
│  │                        │    │                          │  │
│  │  Ownership = UTXO      │    │  Membership = balance    │  │
│  │  Discoverable in       │    │  Discoverable in         │  │
│  │  any Ordinals explorer │    │  any Rune indexer        │  │
│  └───────────────────────┘    └──────────────────────────┘  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              CITREA BATCH PROOFS                      │   │
│  │   (ZK-proven state diffs — computational integrity)   │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ writes to Bitcoin
                            │
┌─────────────────────────────────────────────────────────────┐
│                    CITREA (L2)                               │
│                 Processing Layer                             │
│                                                             │
│  Institution.sol    ProcessTemplate.sol    ProcessInstance.sol│
│  BINSTDeployer.sol                                          │
│                                                             │
│  Turing-complete logic:                                     │
│  - Step execution with validation                           │
│  - Payment processing                                       │
│  - Complex multi-step workflows                             │
│  - Event emission and indexing                              │
│  - Cross-contract calls                                     │
│                                                             │
│  Reads Rune balances via Clementine bridge ←── membership   │
│  Reads inscription IDs via oracle/bridge   ←── identity     │
└─────────────────────────────────────────────────────────────┘
```

---

## Protocol flows

### Creating an institution

```
1. Admin inscribes institution on Bitcoin (Ordinal)
   → metaprotocol: "binst", body: institution metadata
   → gets inscription ID: abc123...i0
   → inscription lives in admin's UTXO → admin owns it

2. Admin etches membership Rune on Bitcoin
   → INSTITUTION•MEMBER, premine: 1
   → admin holds the initial unit

3. Admin deploys Institution.sol on Citrea
   → constructor gets: name, admin address, inscription_id, rune_id
   → contract stores the Bitcoin identity references

4. Citrea contract state reaches Bitcoin via batch proof
   → institution is now represented THREE ways on Bitcoin:
      a) Ordinal inscription (identity + metadata)
      b) Rune (membership token)
      c) State diff in batch proof (computational state)
```

### Adding a member

```
1. Admin sends 1 INSTITUTION•MEMBER rune to new member's address
   → member now holds membership token in their Bitcoin wallet
   → visible in any Rune-aware wallet or indexer

2. Admin calls addMember(memberAddress) on Citrea
   → Citrea contract updates member list
   → (optional: contract verifies Rune balance via bridge)

3. Citrea state diff reaches Bitcoin via batch proof
   → member addition is now ZK-proven on Bitcoin
```

### Executing a process step

```
1. Member calls executeStep() on Citrea ProcessInstance
   → complex validation, payment, state transitions happen on Citrea
   → event emitted: StepExecuted(who, stepIndex, timestamp)

2. (Optional) Member inscribes step execution as child of instance
   → permanent, discoverable record on Bitcoin
   → not required for protocol correctness (batch proof handles that)
   → makes it human-readable on explorers

3. Citrea batch proof writes state diff to Bitcoin
   → step execution is ZK-proven
```

---

## What each layer guarantees

| Layer | What it proves | Trust assumption | Discoverability |
|---|---|---|---|
| **Ordinal inscription** | Entity exists, metadata is set, admin controls it | Bitcoin consensus | Any Ordinals explorer/wallet |
| **Rune balance** | This person is a member | Bitcoin consensus | Any Rune indexer/wallet |
| **Citrea batch proof** | Every state transition was computationally correct | Bitcoin consensus + ZK math | taproot-reader + full node |
| **Citrea RPC** | Current live state | Trust Citrea node operator | Citrea RPC access |

---

## Entity-to-primitive mapping

| Entity | Nature | Bitcoin primitive | Reasoning |
|---|---|---|---|
| **Institution** | Unique, one-of-one | Ordinal inscription | Needs metadata, provenance, UTXO-based ownership |
| **Process Template** | Unique, immutable | Ordinal inscription (child of institution) | Unique artifact with structured content |
| **Process Instance** | Unique, mutable state | Ordinal inscription (child of template) | State updates via child inscriptions or batch proofs |
| **Membership** | Fungible relationship | Rune balance | "Hold ≥1 token = member" is a standard balance check |
| **Step Execution** | Immutable event record | Ordinal inscription (child of instance) | Permanent discoverable record |
| **Governance vote** | Fungible weight | Rune balance (separate per institution) | Transferable, weighted voting power |

---

## The `BitcoinIdentity` type

Every BINST entity in the decoder carries a `BitcoinIdentity` struct
linking it across all reachability layers:

```rust
pub struct BitcoinIdentity {
    /// EVM address from Citrea state (always available)
    pub evm_address: [u8; 20],

    /// Taproot x-only public key (controls the Ordinal inscription)
    pub bitcoin_pubkey: Option<[u8; 32]>,

    /// Ordinals inscription ID (e.g., "abc123...i0")
    pub inscription_id: Option<String>,

    /// Rune ID for membership token (e.g., "840000:20")
    pub membership_rune_id: Option<String>,

    /// HD derivation path hint (e.g., "m/86'/0'/0'/0/0")
    pub derivation_hint: Option<String>,
}
```

Four layers of reachability:
1. `evm_address` — find it on Citrea
2. `bitcoin_pubkey` — verify the controller on Bitcoin
3. `inscription_id` — look it up on any Ordinals explorer
4. `membership_rune_id` — check membership in any Rune wallet

---

## Discovery: who needs what

| What you want to know | Where to look | Full node needed? |
|---|---|---|
| Does institution X exist? | Ordinals explorer | ❌ No |
| Who is the admin? | Inscription UTXO owner | ❌ No |
| Am I a member? | Rune balance in wallet | ❌ No |
| Who are all members? | Rune indexer query | ❌ No |
| What processes exist? | Child inscriptions | ❌ No |
| What step is instance Y on? | Citrea RPC | ❌ No |
| Was step execution valid? | ZK batch proof decode | ✅ Yes |
| Full trustless verification? | taproot-reader | ✅ Yes |

**Basic discovery requires no custom software and no full node.** Standard
Ordinals and Rune tooling covers identity, ownership, membership, and
provenance. The full node is only needed for the strongest verification
tier — independently confirming ZK proofs.

---

## Cost analysis

| Operation | Mechanism | Approx. cost (at 10 sat/vB) |
|---|---|---|
| Create institution | Ordinal inscription (~500B text) | ~$2-5 |
| Create process template | Child inscription (~300B) | ~$1-3 |
| Record step execution | Child inscription (~200B) | ~$0.50-2 |
| Etch membership Rune | Runestone in OP_RETURN | ~$1-3 |
| Mint membership for 1 user | Runestone transaction | ~$0.50-1 |
| Transfer institution admin | Send UTXO (standard tx) | ~$0.30-1 |
| **Total: institution + template + 10 members** | | **~$15-30** |

Testnet4 is free during development. Mainnet costs scale with fee rates
but remain reasonable for institutional operations that happen infrequently.

---

## Implementation phases

### Phase 1: Inscription identity
- Define the `binst` metaprotocol JSON schema (institution/template/instance)
- Script to inscribe an institution on Bitcoin testnet4 using `ord`
- Add `inscription_id` field to Solidity contracts
- Update taproot-reader to find `binst` metaprotocol inscriptions
- Update `BitcoinIdentity` struct with `inscription_id`

### Phase 2: Membership Runes
- Etch a test Rune per institution on testnet4
- Add `rune_id` field to Institution.sol
- Script to mint and distribute membership Runes
- Update `BitcoinIdentity` struct with `membership_rune_id`
- Explore Clementine bridge for Rune balance verification on Citrea

### Phase 3: Bitcoin-native discovery
- Indexer that watches for `binst` metaprotocol inscriptions
- API: "list all BINST institutions" → Ordinals query for `metaprotocol=binst`
- API: "list members of institution X" → Rune balance query for `X•MEMBER`
- API: "verify institution state" → cross-reference inscription, Rune, batch proof

### Phase 4: Deep Bitcoin integration
- Covenant-guarded institution treasuries (if OP_CTV/OP_CAT activates)
- Multi-sig institution admin via Taproot MuSig2
- Cross-institution process verification using inscription provenance chains
- Rune-gated access control (hold ≥1 `X•MEMBER` to interact)

---

## Related documents

- `conceptual.md` — non-technical overview of the three-layer architecture
- `DECODING.md` — technical reference for Citrea DA transaction decoding
- `crates/binst-decoder/src/entities.rs` — `BitcoinIdentity` struct implementation
- `crates/binst-decoder/src/storage.rs` — Solidity storage slot computation
