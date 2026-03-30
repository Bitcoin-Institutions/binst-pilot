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

### UTXO safety: accidental spending risk

Because inscriptions are bound to specific UTXOs, an admin who spends
the inscription UTXO in a non-Ordinals-aware wallet (e.g., as part of
a regular payment or consolidation) **loses control of the inscription**.
The inscription data remains permanently on Bitcoin — it is never
destroyed — but the UTXO tracking it moves to an unknown party or
gets consumed as miner fees.

This is a known risk across the entire Ordinals ecosystem, but it is
**more consequential for BINST** than for image NFTs because losing an
institution's identity inscription means losing the UTXO-based ownership
signal.

#### Script-level guard (Taproot vault)

Rather than relying solely on wallet discipline, BINST institution
inscriptions should be locked in a **Taproot script tree that prevents
accidental spending at the consensus level**:

```
Taproot output:
  Internal key: NUMS point (unspendable — disables key-path spend)

  Script tree:
    Leaf 0 (admin transfer — time-delayed):
      <admin_pubkey> OP_CHECKSIG
      <144> OP_CHECKSEQUENCEVERIFY OP_DROP     ← ~24h delay (144 blocks)

    Leaf 1 (committee override — immediate):
      <2> <key_A> <key_B> <key_C> <3> OP_CHECKMULTISIG
```

**How it works:**

| Path | Who | Delay | Purpose |
|---|---|---|---|
| Key path | Nobody | ∞ | Disabled (NUMS internal key). No wallet can accidentally spend via key path. |
| Leaf 0 | Admin (single key) | ~24 hours (144 blocks CSV) | Deliberate admin transfer. The delay gives time to abort if the key is compromised. |
| Leaf 1 | 2-of-3 committee | Immediate | Emergency override: recover from key loss, or move inscription in time-sensitive situations. |

**Why this works for BINST:**

- **No accidental spending** — the key path is dead. A regular wallet
  that tries to sign a standard transaction will fail because the
  internal key is unspendable. Only the script paths work.
- **Admin retains control** — Leaf 0 lets the admin deliberately move
  the inscription (e.g., to a new address, or for a re-inscription),
  but the CSV delay acts as a safety net.
- **Committee backstop** — Leaf 1 is the "break glass" path. If the
  admin key is lost or compromised, the 2-of-3 multi-sig can recover
  the inscription immediately.
- **Standard Bitcoin** — this uses only Taproot features available today
  (BIP 341/342, OP_CHECKSIG, OP_CHECKSEQUENCEVERIFY, OP_CHECKMULTISIG).
  No OP_CTV or OP_CAT needed.
- **Ordinals-compatible** — the `ord` indexer tracks inscriptions by
  ordinal theory regardless of the spending script. A Taproot script
  tree does not interfere with inscription tracking.

**Future enhancement with covenants:** When OP_CTV or OP_CAT activates
on Bitcoin, the script can be upgraded to enforce that the inscription
UTXO can *only* be spent to a pre-defined set of addresses (e.g., back
to the admin's own vault). This would make it truly non-transferable
except via explicit covenant paths.

#### Spending from the vault (unlock flow)

The vault **locks** the inscription UTXO, but it does not make it
permanently frozen. The admin can deliberately unlock it whenever needed.
Here is exactly what happens for each path:

**Path A — Admin transfer (Leaf 0, ~24h delay):**

```
1. Admin decides to move the inscription (e.g., to a new vault,
   to transfer ownership, or to perform a reinscription).

2. Admin waits until the UTXO is at least 144 blocks old
   (relative lock-time from when the UTXO was created/last spent).

3. Admin constructs a Bitcoin transaction:
   - Input: the vault UTXO
     - nSequence = 144 (satisfies OP_CHECKSEQUENCEVERIFY)
     - Witness: <admin_signature> <leaf_0_script> <control_block>
       where control_block = internal_key ‖ merkle_proof_to_leaf_0
   - Output 0: new destination address (e.g., a fresh vault for the same
     admin, or a new owner's vault address)
   - Output 1: change (if any)

4. Bitcoin consensus validates:
   a) admin_signature is valid for admin_pubkey    → OP_CHECKSIG ✓
   b) nSequence ≥ 144 blocks have passed           → OP_CSV ✓
   c) Taproot script-path commitment is correct     → control_block ✓

5. Transaction confirms. The inscription sat moves to the new output.
   The ord indexer updates the ownership record.
```

**Path B — Committee override (Leaf 1, immediate):**

```
1. Emergency: admin key is lost/compromised, or the institution
   needs to move the inscription urgently.

2. Two of three committee members agree and co-sign.

3. Committee constructs a Bitcoin transaction:
   - Input: the vault UTXO
     - nSequence = 0 (no CSV required on this leaf)
     - Witness: <0x00> <sig_A> <sig_B> <leaf_1_script> <control_block>
       where control_block = internal_key ‖ merkle_proof_to_leaf_1
   - Output 0: recovery destination

4. Bitcoin consensus validates:
   a) 2-of-3 multisig is satisfied                → OP_CHECKMULTISIG ✓
   b) Taproot script-path commitment is correct    → control_block ✓

5. Transaction confirms immediately (no waiting period).
```

**Re-locking after a spend:**

When the inscription moves out of the vault, the admin should send it
to a **new vault address** (generated with the same or updated keys)
to maintain the script-guard protection. The cycle is:

```
  Vault A  ──(admin spends after CSV)──▶  Vault B  ──(...)──▶  Vault C
    │                                        │
    └── inscription sat protected             └── re-locked, CSV resets
```

Each vault-to-vault transfer **resets the CSV timer** — the 144-block
countdown starts fresh from the block where Vault B's UTXO is confirmed.

**When would the admin unlock?**

| Scenario | Which path | What happens next |
|---|---|---|
| Transfer institution to new admin | Leaf 0 (admin) | Send to new admin's vault; update Citrea `transferAdmin()` |
| Rotate admin key | Leaf 0 (admin) | Send to vault with new admin pubkey |
| Reinscribe (update metadata) | Leaf 0 (admin) | Spend → new reveal TX → re-vault |
| Admin key compromised | Leaf 1 (committee) | Committee moves to safe address; admin rotates keys |
| Admin key lost | Leaf 1 (committee) | Committee recovers to new admin's vault |
| Move to covenant-upgraded vault | Leaf 0 (admin) | Migrate to OP_CTV vault when available |

**What if the admin never needs to unlock?**

That's fine — the inscription sits in the vault indefinitely. The sat is
safe, the inscription data is permanent, and the Citrea contract keeps
running. The vault is a safety net, not a requirement for normal operations.

#### Sat isolation (dedicated UTXO)

The inscribed satoshi should live on its own **dedicated, minimal UTXO**
— separate from any spending funds. This is standard Ordinals practice
and the `ord` tooling does it by default.

During the reveal transaction, two outputs are created:

```
Reveal TX:
  Input 0:  commit UTXO (inscription envelope in witness)

  Output 0: 546 sats → Taproot vault address (script-guarded)
             ↑ the inscribed sat lives HERE, alone
             ├── NUMS internal key (no key-path spend)
             ├── Leaf 0: admin + 144-block CSV delay
             └── Leaf 1: 2-of-3 committee multisig

  Output 1: change → admin's regular spending wallet
             Normal sats, freely spendable, no inscription.
```

The **pointer tag** (Ordinals tag 2) in the envelope explicitly binds
the inscription to the first satoshi of output 0. This guarantees:

- The inscribed sat is **physically isolated** — 546 sats (dust limit),
  containing nothing of spending value
- Change sats go to a **separate output** on a regular address
- No economic incentive to sweep the inscription UTXO
- Combined with the Taproot vault script: the isolated UTXO is also
  **consensus-locked** against accidental spends

This gives two independent layers of protection:
1. **Economic** — dust-limit UTXO has no spending value to attract
2. **Consensus** — script guard prevents spending even if attempted

#### Additional mitigations

| Layer | Mitigation | Effect |
|---|---|---|
| Wallet discipline | Use only Ordinals-aware wallets (Xverse, Unisat, `ord wallet`) | Inscription UTXOs are frozen and cannot be accidentally spent |
| Key isolation | Dedicated key/address for inscription UTXOs only | No mixing with spending funds eliminates accidental inclusion |
| Protocol design | Inscription = identity record, **not** sole ownership proof | Citrea contract (`admin` address) is the authoritative owner |
| Recovery path | Re-inscribe as child of original + update Citrea contract | Admin can recover from UTXO loss without losing history |

#### Graceful degradation

**The critical design principle:** the Citrea smart contract is always
the authoritative source of truth for who controls an institution. The
inscription UTXO is a *strong supplementary signal* — it lets anyone
on Bitcoin verify ownership without Citrea — but it is not a single
point of failure. If the inscription UTXO is somehow lost despite the
script guard:

1. The inscription **data** is permanent and readable forever
2. The Citrea contract **continues to function** normally
3. The admin **re-inscribes** a recovery record (child of the original)
4. The Citrea contract is **updated** to reference the new inscription
5. The original inscription's provenance chain is **preserved**

This means BINST degrades gracefully: losing the UTXO costs you the
Bitcoin-native ownership proof, but the institution keeps running on
Citrea while you recover.

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

| Layer | What it proves | Trust assumption | Discoverability | Failure mode |
|---|---|---|---|---|
| **Ordinal inscription** | Entity exists, metadata is set, admin controls UTXO | Bitcoin consensus | Any Ordinals explorer/wallet | UTXO accidentally spent → lose ownership signal, data survives |
| **Rune balance** | This person is a member | Bitcoin consensus | Any Rune indexer/wallet | Token accidentally sent → membership lost until re-minted |
| **Citrea contract** | Authoritative state: admin, members, processes | Bitcoin consensus + ZK math | Citrea RPC | Citrea down → state frozen, resumes when back |
| **Citrea batch proof** | Every state transition was computationally correct | Bitcoin consensus + ZK math | taproot-reader + full node | Proof missing → state unverifiable until next batch |

**No single layer is a single point of failure.** The Citrea contract is the
operational authority; inscriptions and Runes are supplementary Bitcoin-native
signals. Losing one layer degrades the experience but does not break the protocol.

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
- **Build Taproot vault script** for inscription UTXOs (NUMS internal key,
  admin CSV-delayed path, 2-of-3 committee override path)
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
- **Covenant-upgraded vault** (when OP_CTV/OP_CAT activates): inscription
  UTXO can only be spent to pre-approved addresses
- Multi-sig institution admin via Taproot MuSig2
- Cross-institution process verification using inscription provenance chains
- Rune-gated access control (hold ≥1 `X•MEMBER` to interact)

---

## Related documents

- `conceptual.md` — non-technical overview of the three-layer architecture
- `DECODING.md` — technical reference for Citrea DA transaction decoding
- `crates/binst-decoder/src/entities.rs` — `BitcoinIdentity` struct implementation
- `crates/binst-decoder/src/storage.rs` — Solidity storage slot computation
