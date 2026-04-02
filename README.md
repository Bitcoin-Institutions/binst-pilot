# BINST Pilot — Bitcoin-Sovereign Institutional Processes

Proof-of-concept: institutional processes (KYC, compliance, approvals) where
**the Bitcoin key is the root of authority**. Identity lives on Bitcoin via
Ordinals inscriptions. Membership lives on Bitcoin via Runes. Complex logic
executes on an L2 (currently Citrea) as a **delegate** of the key holder —
portable to any future L2.

```
Bitcoin L1 (ROOT OF AUTHORITY)
├── Ordinals    → entities EXIST here  (inscriptions = identity)
├── Runes       → membership IS here   (tokens = roles)
└── ZK proofs   → computation PROVEN   (L2 batch proofs)

L2 — currently Citrea (PROCESSING DELEGATE)
└── Solidity    → complex logic executes on behalf of BTC key holder
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│               BITCOIN (L1) — ROOT OF AUTHORITY               │
│                                                             │
│  ┌───────────────────────┐    ┌──────────────────────────┐  │
│  │  ORDINAL INSCRIPTIONS  │    │        RUNES             │  │
│  │  metaprotocol: "binst" │    │  ACME•MEMBER (fungible)  │  │
│  │                        │    │                          │  │
│  │  Institution           │    │  Hold ≥1 = member        │  │
│  │   └─ ProcessTemplate   │    │  Visible in any Rune     │  │
│  │       └─ Instance      │    │  wallet or indexer       │  │
│  │           └─ StepEvent │    │                          │  │
│  │                        │    │                          │  │
│  │  UTXO owner = admin    │    │                          │  │
│  │  ★ AUTHORITATIVE ★    │    │                          │  │
│  └───────────────────────┘    └──────────────────────────┘  │
│                                                             │
│  Taproot vault: NUMS key path (unspendable) + script guard  │
│  Admin: CSV-delayed spend │ Committee: 2-of-3 immediate     │
└──────────────────────────┬──────────────────────────────────┘
                           │ ZK batch proofs
                           ▼
┌─────────────────────────────────────────────────────────────┐
│           L2 PROCESSING DELEGATE (currently Citrea)          │
│                                                             │
│  BINSTDeployer → Institution → ProcessTemplate → Instance   │
│                                                             │
│  Contract is BOUND TO inscription ID.                       │
│  User can redeploy to any L2 — identity stays on Bitcoin.   │
│                                                             │
│  Cross-chain: LayerZero V2 mirrors identity to other L2s.   │
│  Execution state verified trustlessly via Bitcoin DA proofs. │
└─────────────────────────────────────────────────────────────┘
```

### Authority model

The Bitcoin private key controls everything:

| Layer | What it controls | Can the user switch it? |
|-------|-----------------|------------------------|
| **Inscription UTXO** | Identity, metadata, provenance | No — this IS the identity |
| **Rune distribution** | Membership tokens | No — lives on Bitcoin L1 |
| **L2 contract** | Processing logic (workflows, payments) | **Yes** — redeploy to any L2 |
| **Mirror contracts** | Read-only identity/membership on other L2s | **Yes** — add/remove mirrors |

Losing the L2 is graceful (redeploy elsewhere). Losing the Bitcoin key is
catastrophic (committee multi-sig recovery required).

---

## Contracts (Solidity 0.8.24, Shanghai EVM)

| Contract | Description |
|----------|-------------|
| `BINSTDeployer` | Factory/registry — creates institutions and deploys process templates |
| `Institution` | Institution entity — members, admin, Bitcoin identity (`inscriptionId`, `runeId`) |
| `ProcessTemplate` | Immutable workflow blueprint with named steps |
| `ProcessInstance` | Running execution with step-by-step state tracking |

All contracts are deployed and verified on Citrea Testnet (chain 5115).

---

## Taproot Reader (Rust workspace)

A Rust workspace that decodes BINST data directly from Bitcoin:

| Crate | Description |
|-------|-------------|
| `citrea-decoder` | Parses Citrea DA inscriptions (sequencer commitments, batch proofs) from raw tapscript witness |
| `binst-decoder` | Maps L2 storage slot diffs → BINST entities. Includes human-readable value decoding (addresses, uints, bools, strings, packed structs) with Citrea LE→BE word reversal |
| `binst-inscription` | Parses Ordinals envelopes for `binst` metaprotocol inscriptions; typed entity bodies |
| `cli` (`citrea-scanner`) | Binary that scans Bitcoin Core or queries Citrea RPC for DA transactions. Supports `--discover` to auto-find BINST contracts |

### Bitcoin identity (`BitcoinIdentity` struct)

Every entity carries a `BitcoinIdentity` where the Bitcoin pubkey is the root:

```rust
pub struct BitcoinIdentity {
    pub bitcoin_pubkey: [u8; 32],         // ROOT — controls inscription UTXO
    pub inscription_id: Option<String>,   // permanent identity on Bitcoin
    pub membership_rune_id: Option<String>, // membership token
    pub evm_address: Option<[u8; 20]>,    // current L2 delegate (can change)
    pub derivation_hint: Option<String>,
}
```

### JSON schema

The `binst` metaprotocol uses a [JSON Schema](taproot-reader/schema/binst-metaprotocol.json)
defining four entity types: `institution`, `process_template`, `process_instance`, `step_execution`.
See [schema/README.md](taproot-reader/schema/README.md) for examples.

---

## Scripts

| Script | Description |
|--------|-------------|
| `inscribe-binst.ts` | Generate `ord` commands to inscribe BINST entities on Bitcoin testnet4 |
| `taproot-vault.ts` | Build Taproot leaf scripts for inscription UTXO safety (NUMS + CSV + multisig) |
| `demo-flow.ts` | End-to-end demo: deploy institution → create process → execute steps |
| `bitcoin-awareness.ts` | Read Bitcoin Light Client, query finality RPCs |
| `finality-monitor.ts` | Poll Citrea RPCs until a watched L2 block is committed / ZK-proven |
| `test-protocol.ts` | Protocol test against live Citrea testnet |

---

## Quick Start

```bash
# Install
npm install

# Compile Solidity (Shanghai EVM)
npx hardhat compile

# Run tests (14 Solidity + 68 Rust = 82 total)
npx hardhat test
cd taproot-reader && cargo test

# Run demo (local Hardhat)
npx hardhat run scripts/demo-flow.ts

# Deploy to Citrea Testnet
cp .env.example .env   # add CITREA_PRIVATE_KEY, BTC_RPC_PASS, etc.
npx hardhat run scripts/demo-flow.ts --network citreaTestnet

# Generate inscription command for testnet4
npx ts-node scripts/inscribe-binst.ts institution "Acme Financial" <admin_x_only_pubkey>

# Generate Taproot vault scripts
npx ts-node scripts/taproot-vault.ts <admin_pubkey> <committee_key_A> <committee_key_B> <committee_key_C>

# Bitcoin awareness (reads Citrea Light Client, no deployment needed)
npx tsx scripts/bitcoin-awareness.ts

# Monitor finality for a specific L2 block
WATCH_L2=23972426 npx tsx scripts/finality-monitor.ts
```

---

## Citrea Testnet Config

| Setting | Value |
|---------|-------|
| RPC | `https://rpc.testnet.citrea.xyz` |
| Chain ID | `5115` |
| EVM | Shanghai (no Cancun) |
| Currency | cBTC |
| Faucet | Citrea Discord `#faucet` |
| Explorer | [`explorer.testnet.citrea.xyz`](https://explorer.testnet.citrea.xyz) |

---

## Bitcoin Anchoring

BINST relies on Citrea's rollup infrastructure to anchor all L2 activity to Bitcoin:

1. Every BINST transaction lives in a Citrea L2 block
2. The sequencer inscribes **Sequencer Commitments** (Merkle roots) on Bitcoin — pins ordering
3. The batch prover inscribes **ZK proofs** (Groth16 via RISC Zero) on Bitcoin with state diffs — proves correctness
4. Anyone with a Bitcoin node can **reconstruct the entire L2 state** including all BINST data

| Finality level | What happens | How to verify |
|----------------|-------------|---------------|
| **Soft Confirmation** | Sequencer signs the L2 block | Transaction receipt |
| **Committed** | Sequencer commitment inscribed on Bitcoin | `citrea_getLastCommittedL2Height` |
| **ZK-Proven** | ZK batch proof inscribed on Bitcoin | `citrea_getLastProvenL2Height` |

The `taproot-reader` Rust workspace can decode these inscriptions directly
from a Bitcoin full node — see [DECODING.md](taproot-reader/DECODING.md).

### Citrea RPC mode (no Bitcoin node required)

The `citrea-scanner` CLI can also query batch proofs directly from a Citrea
full node, without needing a local Bitcoin Core:

```bash
# Scan a BTC block via Citrea RPC with auto-discovery of BINST contracts
cargo run --bin citrea-scanner -- \
  --citrea-rpc https://rpc.testnet.citrea.xyz \
  --discover \
  --deployer 0xd0abca83bd52949fcf741d6da0289c5ec7235aaf \
  --block 127848

# Manual addresses (skip discovery)
cargo run --bin citrea-scanner -- \
  --citrea-rpc https://rpc.testnet.citrea.xyz \
  --deployer 0x... --template 0x... --instance 0x... \
  --block 127848
```

The `--discover` flag queries the deployer contract on-chain to crawl the full
registry: `deployer → institutions → templates → instances`.

### Human-readable value decoding

State diff values are automatically decoded from raw hex to human-readable form:

```
ProcessTemplate.name = "KYC Verification"
ProcessInstance.creator = 0x8cf6fe5cd0905b6bfb81643b0dcda64af32fd762
ProcessInstance.stepStates[0] = Completed by 0x8cf6fe5cd0905b6bfb81643b0dcda64af32fd762
ProcessInstance.currentStepIndex = 4
ProcessInstance.completed = true
BINSTDeployer.institutions[0] = 0x3a6a07c5d2c420331f68dd407aafff92f3275a86
```

| Solidity type | Decoded form |
|---|---|
| `address` | `0x8cf6fe5c…d762` |
| `uint256` | `4`, `1774750572` |
| `bool` | `true` / `false` |
| `string` (short ≤31 bytes) | `"KYC Verification"` |
| `string` (long) | `<string, 62 bytes>` |
| `StepState` (packed struct) | `Completed by 0x8cf6…d762` |
| `bytes32` | `0x…` hex |

**Key discovery:** Citrea / Sovereign SDK stores EVM storage values in
little-endian word order — the entire 32-byte slot is byte-reversed compared
to standard Solidity ABI encoding. The decoder pads to 32 bytes and reverses
before interpreting.

---

## Documentation

| Document | Description |
|----------|-------------|
| [BITCOIN-IDENTITY.md](taproot-reader/BITCOIN-IDENTITY.md) | Full architecture: authority model, Taproot vault, lock/unlock flows, L2 portability |
| [conceptual.md](taproot-reader/conceptual.md) | Non-technical overview of the three-layer architecture |
| [DECODING.md](taproot-reader/DECODING.md) | Technical reference for Citrea DA transaction decoding |
| [schema/README.md](taproot-reader/schema/README.md) | BINST metaprotocol JSON schema and examples |

---

## Tech Stack

- **Hardhat 3** with Viem (not ethers)
- **Solidity 0.8.24** targeting Shanghai EVM
- **Rust 1.94** — taproot-reader workspace (4 crates, 68 tests)
- **TypeScript** (ESM)
- **Citrea Testnet** (chain 5115, Bitcoin Testnet4 DA layer)
- **Bitcoin Core** testnet4 for full-node verification (optional — Citrea RPC mode available)

## Part of BINST

This pilot is part of [Bitcoin Institutions (BINST)](https://github.com/Bitcoin-Institutions/BINST) —
a protocol for creating transparent, Bitcoin-sovereign institutions where
the user's Bitcoin key controls everything and L2 smart contracts are
portable processing delegates.
