# How BINST Reads Institutions from Bitcoin

A non-technical explanation of how the taproot-reader module finds and decodes
institutional activity that was originally recorded on Citrea (a Bitcoin L2)
by scanning the Bitcoin blockchain itself.

---

## The big picture

BINST is a protocol for creating and operating transparent institutions on
Bitcoin. When someone creates an institution, defines a process, or completes
a step in that process, those actions happen on **Citrea** — a Layer 2 network
that runs smart contracts. Citrea then periodically writes compressed summaries
of all its activity into **Bitcoin transactions**, using a feature called
**Taproot script-path spends**.

This means that every institutional action eventually ends up **on Bitcoin
itself**, bundled alongside thousands of other Citrea transactions into a
compact cryptographic package. The taproot-reader module is the tool that
finds those packages on Bitcoin and extracts the institutional data from them.

Think of it this way:

```
Institutions, processes, steps
        ↓  (happen on Citrea)
Citrea batches everything together
        ↓  (writes to Bitcoin every few minutes)
Bitcoin stores the batches permanently
        ↓  (our scanner reads them back)
Taproot-reader decodes the institutional data
```

---

## What ends up on Bitcoin and in what form

Citrea writes two kinds of summaries to Bitcoin:

### 1. Sequencer Commitments — "here is what happened, in order"

Every few minutes, the Citrea sequencer (the node that orders transactions)
takes a batch of recent L2 blocks, computes a fingerprint (a Merkle root of
all block hashes in the batch), and writes that fingerprint into a Bitcoin
transaction.

This is like a notary stamping a document: it proves that a specific sequence
of events happened in a specific order. But it does not reveal the contents —
just the fingerprint.

**What it contains:**
- A fingerprint (Merkle root) of the L2 blocks in this batch
- A sequence number (e.g., commitment #16,649)
- The last L2 block number covered (e.g., block 23,924,028)

### 2. Batch Proofs — "here is mathematical proof that everything was correct"

Periodically, a separate component (the prover) generates a **zero-knowledge
proof** — a mathematical guarantee that every transaction in a range of L2
blocks was executed correctly according to the rules. This proof, along with a
summary of what changed (the "state diff"), is written to Bitcoin.

This is the strongest guarantee. Once a batch proof is on Bitcoin, anyone with
a Bitcoin node can independently verify that the institutional actions were
valid — without trusting Citrea at all.

**What it contains:**
- A compact mathematical proof (ZK proof, ~12 KB)
- A state diff: every storage value that changed during this batch
- The range of L2 blocks and sequencer commitments covered

### What about the actual institution data?

The institution names, member lists, process steps, and execution history are
not written to Bitcoin as readable text. They are encoded inside the **state
diff** of batch proofs — as raw key-value pairs representing EVM storage slot
changes.

To go from "storage slot `0xa4f2...` changed to `0x0001`" to "Alice completed
step 2 of the KYC process at Acme Financial" requires knowing the contract's
storage layout — which our decoder understands because we wrote the contracts.

---

## How accurate is the search

### Can we avoid parsing every transaction in a block?

**Almost.** Citrea transactions are identified by a 2-byte prefix on their
**witness transaction ID** (wtxid). Every Citrea transaction is crafted so its
wtxid starts with `0x02 0x02`. This means:

- For each block, we compute the wtxid of every transaction
- If the wtxid does **not** start with `0x0202`, we skip it immediately
- Only matching transactions (roughly **1 in 65,536** by random chance) get
  fully parsed

In practice, most Bitcoin testnet4 blocks contain 1–5 transactions total.
A block with 200 transactions might have 2–3 Citrea inscriptions. The prefix
filter eliminates 99.99% of transactions with a single 2-byte comparison —
no script parsing, no deserialization, just a prefix check.

**False positives** (non-Citrea transactions that happen to start with
`0x0202`) are caught in the next step when we try to parse the tapscript
structure. A false positive would fail to match the expected opcode sequence
(`PUSH32 <pubkey> OP_CHECKSIGVERIFY PUSH2 <kind> ...`) and be discarded.

So the effective false-positive rate is essentially zero.

### Can we make it even faster?

**Yes, but not at the Bitcoin protocol level.** Bitcoin does not index
transactions by witness content — there is no way to ask a Bitcoin node
"give me all transactions whose wtxid starts with 0x0202." We must scan
every transaction in every block.

However, there are two acceleration strategies:

**Strategy 1: Track known block ranges.** Citrea's RPC tells us exactly
which Bitcoin block heights contain sequencer commitments and batch proofs:

```
citrea_getLastCommittedL2Height  →  we know roughly which BTC blocks to scan
ledger_getSequencerCommitmentsOnSlotByNumber(btcHeight)  →  jump directly to a block
```

Instead of scanning every block, we can ask Citrea "which Bitcoin blocks
have your data?" and only scan those. This reduces the search space from
thousands of blocks to dozens.

**Strategy 2: Maintain a local index.** Once we scan a block, we store the
results (block height → list of decoded inscriptions). Future queries are
instant lookups instead of re-scans.

---

## Should we add wallet-based ownership for quicker searches?

This is an interesting architectural question. Today, all Citrea inscriptions
come from **two addresses**: the sequencer's address (for commitments) and
the prover's address (for batch proofs). If BINST institutions had their
own Bitcoin addresses, could we filter faster?

### The short answer: no, and here's why

The data that reaches Bitcoin is not written by individual institutions.
It is written by Citrea's infrastructure — the sequencer and the prover —
on behalf of **all** Citrea activity. A single sequencer commitment covers
thousands of L2 transactions from hundreds of different users and contracts.
There is no way to make one institution's data appear at a specific Bitcoin
address because the batching happens at the Citrea level, not the
institution level.

The filtering we need happens **after** we decode the Citrea data:

```
Bitcoin block
  → filter by wtxid prefix (find Citrea txs)
    → decode batch proof (extract state diff)
      → filter by contract address (find BINST data)
        → filter by storage slot (find specific institution)
```

### What wallet-based ownership IS useful for — and how we prepare for it

While it does not help with Bitcoin-level scanning, giving each institution
a Bitcoin identity (a Taproot address derived from the admin's key) would be
valuable for:

- **Clementine bridge deposits** — an institution could receive BTC directly
  to its own address, which gets bridged to cBTC on Citrea
- **Verification** — "this institution is controlled by the holder of this
  Bitcoin key" is a Bitcoin-native identity proof
- **Future covenants** — if Bitcoin adds OP_CTV or OP_CAT, institution
  treasuries could enforce spending rules at the Bitcoin script level

To prepare for this, the `binst-decoder` crate defines a **`BitcoinIdentity`**
type that every entity carries:

```
BitcoinIdentity {
    evm_address:      [u8; 20]       ← always available (from Citrea state)
    bitcoin_pubkey:   Option<[u8;32]> ← Taproot x-only key (when registered)
    derivation_hint:  Option<String>  ← HD wallet path (e.g. m/86'/0'/0'/0/0)
}
```

Today `bitcoin_pubkey` is `None` — we only have EVM addresses from the
contract storage. When Bitcoin-native identity is added to the protocol
(a contract method like `registerBitcoinKey(bytes32 xOnlyPubKey)`), the
storage decoder will pick up that new slot and populate the field. Every
downstream consumer (webapp, API, verification tool) that checks
`identity.has_bitcoin_key()` will light up automatically.

This is a protocol design decision, not a search optimization — but
the data structures are ready for it today.

---

## How the scanner maps Bitcoin data to protocol entities

### The mapping

| Protocol entity | Where it lives on Citrea | How it appears on Bitcoin |
|---|---|---|
| **Institution** | `Institution.sol` contract at a specific address | Storage slots in batch proof state diffs |
| **Institution name** | `name` storage variable (slot 0) | Key-value pair in state diff |
| **Institution members** | `members` array + `isMember` mapping | Multiple storage slots in state diff |
| **Process template** | `ProcessTemplate.sol` at its own address | Storage slots: step names, descriptions, action types |
| **Process instance** | `ProcessInstance.sol` at its own address | Storage slots: current step, completion status, timestamps |
| **Step execution** | `StepExecuted` event emitted on Citrea | Event logs in the L2 block (referenced by sequencer commitment) |
| **Step completion** | Storage update: `currentStep` incremented | Key-value change in batch proof state diff |

### What we can read today

**Layer 1 — Bitcoin scanning** (`citrea-decoder` crate):
- Find all Citrea inscriptions on any Bitcoin block range
- Decode sequencer commitments: which L2 block ranges are committed to Bitcoin
- Decode batch proofs: extract the raw state diff bytes
- Cross-reference with Citrea RPCs to link L2 blocks to specific transactions

**Layer 2 — Storage layout decoding** (`binst-decoder` crate, new):
- Deterministic slot formulas for all four BINST contracts
- Given a `(contract_address, slot, value)` tuple, identify which protocol
  field it corresponds to (institution name, admin, member list, step index, etc.)
- Reconstruct `InstitutionState`, `ProcessTemplateState`, `ProcessInstanceState`
  objects with typed fields — including the forward-compatible `BitcoinIdentity`
- All Keccak-256 slot computations are verified against known Solidity test vectors

### What still needs to happen

The two layers are built. The remaining gap is the **state diff parser** —
the component that takes the raw bytes from inside a `Complete` batch proof
and splits them into individual `(contract, slot, old_value, new_value)` tuples.

This depends on Citrea's exact state-diff serialisation format (which may evolve
between testnet versions). Once implemented, the full pipeline will be:

```
Bitcoin block
  → citrea-decoder: find inscription, decode Borsh → raw proof bytes
    → state-diff parser: split into (contract, slot, value) tuples
      → binst-decoder: match slot formulas → InstitutionState, ProcessState, etc.
        → BitcoinIdentity on each entity (evm_address now, bitcoin_pubkey later)
```

---

## Why we need a full Bitcoin node

A Bitcoin full node gives us three things that no block explorer or API can:

1. **Complete witness data.** The Citrea inscriptions live inside taproot
   witness fields. Most block explorers strip or truncate witness data.
   A full node gives us every byte.

2. **Trustless verification.** We do not rely on any third-party API to
   tell us what is on Bitcoin. Our node validates every block independently.
   If the data is there, we see it. If it is not, no one can fake it.

3. **No rate limits, no downtime.** Scanning thousands of blocks for Citrea
   transactions requires many RPC calls. A local node handles this instantly.
   A public API would throttle us or go offline.

For the BINST pilot, the full node runs on the developer's home server
connected to Bitcoin Testnet4 — the same test network that Citrea uses as
its data availability layer.

---

## Summary

The taproot-reader does not "search for institutions on Bitcoin" the way you
search for a name in a database. Instead, it follows a layered pipeline:

1. **Scans** Bitcoin blocks for transactions with a specific 2-byte wtxid prefix
2. **Parses** the taproot witness script to extract the Citrea-encoded payload
3. **Deserializes** the payload to identify sequencer commitments and batch proofs
4. **Extracts** the state diff from batch proofs — a compact summary of every
   storage change on Citrea during that proving period
5. **Maps** specific storage slots to BINST contract variables — translating raw
   bytes back into institution names, member lists, process states, and step
   completion records
6. **Attaches** a `BitcoinIdentity` to each entity — today populated with the
   EVM address, tomorrow with a Taproot x-only public key when the protocol
   adds Bitcoin-native identity registration

The result: institutional transparency that is anchored to Bitcoin's security,
verified by zero-knowledge proofs, and readable by anyone running a Bitcoin node.

### Crate architecture

```
taproot-reader/
  crates/
    citrea-decoder/    ← Layer 1: Bitcoin → Citrea inscriptions (no_std, WASM-ready)
    binst-decoder/     ← Layer 2: storage slots → protocol entities (BitcoinIdentity-aware)
    cli/               ← citrea-scanner binary (connects to Bitcoin Core RPC)
```