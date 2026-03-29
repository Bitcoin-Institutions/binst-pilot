# BINST Pilot -- Bitcoin-Anchored Institutional Processes on Citrea# BINST Pilot — Bitcoin-Anchored Institutional Processes on Citrea# BINST Pilot — Bitcoin-Anchored Institutional Processes on Citrea



Proof-of-concept demonstrating **institutional processes** (KYC, compliance, approvals) running on **Citrea** -- a ZK rollup on Bitcoin -- where all activity is automatically committed to Bitcoin via sequencer commitments and ZK batch proofs.



## ArchitectureProof-of-concept demonstrating institutional processes (KYC, compliance, approvals) running on **Citrea** — a ZK rollup on Bitcoin — where all activity is automatically committed to Bitcoin via sequencer commitments and ZK batch proofs.Proof-of-concept demonstrating institutional processes (KYC, compliance, approvals) running on **Citrea** — a ZK rollup on Bitcoin — with on-chain proof that all activity is anchored to Bitcoin via ZK batch proofs.



```

+-------------------------------------------------------------+

|  Citrea (ZK Rollup on Bitcoin)        Chain ID: 5115 (test)  |## Architecture## Architecture

|                                                              |

|  +---------------+                                           |

|  | BINSTDeployer  |-- createInstitution() --.                |

|  | (factory /     |-- deployProcess()  -.   |                |``````

|  |  registry)     |                     |   |                |

|  +---------------+                      |   |                |┌─────────────────────────────────────────────────────────────┐┌─────────────────────────────────────────────────────────────┐

|          |                              v   v                |

|  +---------------+   +-----------------+   +---------------+ |│  Citrea (ZK Rollup on Bitcoin)        Chain ID: 5115 (test) ││  Citrea (ZK Rollup on Bitcoin)        Chain ID: 5115 (test) │

|  | Institution   |-->| ProcessTemplate |-->|ProcessInstance | |

|  | (entity, the  |   | (blueprint)     |   |(running exec) | |│                                                             ││                                                             │

|  |  "I" in BINST)|   +-----------------+   +---------------+ |

|  | - members     |                                           |│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐││  ┌──────────────┐  ┌────────────────┐  ┌──────────────────┐│

|  | - processes   |                                           |

|  +---------------+                                           |│  │BINSTDeployer │→ │ProcessTemplate │→ │ProcessInstance   │││  │BINSTDeployer │→ │ProcessTemplate │→ │ProcessInstance   ││

|                                                              |

|  +----------------------------------------------------------+|│  │(factory)     │  │(blueprint)     │  │(running process) │││  │(factory)     │  │(blueprint)     │  │(running process) ││

|  | Citrea System Contracts (pre-deployed, not ours)          ||

|  |  Bitcoin Light Client  0x3100...0001 -- BTC block hashes  ||│  └──────────────┘  └────────────────┘  └──────────────────┘││  └──────────────┘  └────────────────┘  └──────────────────┘│

|  |  Bridge (Clementine)   0x3100...0002 -- BTC <-> cBTC     ||

|  |  Schnorr Precompile    0x0000...0200 -- BIP-340 verify   ||│   Protocol-critical contracts: state, registry, execution   ││                                                             │

|  +----------------------------------------------------------+|

|                              ^                                |│                                                             ││  ┌──────────────────────────────────────────────────────┐  │

|              Read via eth_call (free, no gas)                 |

|              by off-chain scripts and webapp                  |│  ┌──────────────────────────────────────────────────────────┐││  │ BitcoinAnchor                                         │  │

+-----------------------------+--------------------------------+

                              | Citrea rollup pipeline (auto)│  │ Citrea System Contracts (pre-deployed, not ours)         │││  │ Reads Citrea Bitcoin Light Client (0x31...0001)       │  │

                              v

+-------------------------------------------------------------+│  │  Bitcoin Light Client  0x3100...0001  — BTC block hashes │││  │ → Records BTC block hash at process milestones        │  │

|  Bitcoin (Testnet4)                                          |

|  -> Sequencer commitments (ordering)                         |│  │  Bridge (Clementine)   0x3100...0002  — BTC ↔ cBTC      │││  │ → Proves activity is committed to Bitcoin via ZK      │  │

|  -> ZK batch proofs + state diffs (validity)                 |

|  -> Reconstructable from Bitcoin alone                       |│  │  Schnorr Precompile    0x0000...0200  — BIP-340 verify   │││  └──────────────────────────────────────────────────────┘  │

+-------------------------------------------------------------+

```│  └──────────────────────────────────────────────────────────┘││                                              ▼              │



### Design Principle│                                              ▲               ││                              ┌──────────────────────────┐   │



**Smart contracts for protocol-critical state and webapp visibility only.** Bitcoin awareness and finality tracking are handled off-chain:│                              Read via eth_call (free, no gas)││                              │ Citrea System Contracts   │   │



| Layer | Approach |│                              by off-chain scripts & webapp   ││                              │ Bitcoin Light Client      │   │

|-------|----------|

| **Protocol state** (institutions, processes, steps, registry) | On-chain contracts -- source of truth for webapp |└─────────────────────┬───────────────────────────────────────┘│                              │ Bridge (Clementine/BitVM2)│   │

| **Bitcoin block hashes** | Direct `eth_call` to Light Client `0x3100...0001` -- free, no wrapper needed |

| **Finality tracking** (committed / ZK-proven) | Off-chain monitor polling Citrea RPCs |                      │ Citrea rollup pipeline (automatic)│                              └──────────────────────────┘   │

| **Bridge awareness** (deposits, withdrawals) | Off-chain indexing of Bridge events at `0x3100...0002` |

                      ▼└─────────────────────┬───────────────────────────────────────┘

## Contracts

┌─────────────────────────────────────────────────────────────┐                      │ ZK Batch Proofs inscribed on Bitcoin

| Contract | Description |

|----------|-------------|│  Bitcoin (Testnet4)                                         │                      ▼

| `BINSTDeployer` | Factory/registry -- creates institutions and standalone processes |

| `Institution` | On-chain institution entity -- members, roles, owns process templates |│  → Sequencer commitments (ordering)                         │┌─────────────────────────────────────────────────────────────┐

| `ProcessTemplate` | Immutable blueprint with named steps (adapted from DeBu Studio) |

| `ProcessInstance` | Running execution with step-by-step state tracking |│  → ZK batch proofs + state diffs (validity)                 ││  Bitcoin (Testnet4)                                         │



## Off-chain Bitcoin Tooling│  → Reconstructable from Bitcoin alone                       ││  → Sequencer commitments → ZK proofs → Finality             │



| Script | Description |└─────────────────────────────────────────────────────────────┘└─────────────────────────────────────────────────────────────┘

|--------|-------------|

| `scripts/bitcoin-awareness.ts` | Reads Light Client, queries finality RPCs, finds commitments and proofs |``````

| `scripts/finality-monitor.ts` | Polls Citrea RPCs until a watched L2 block is committed / ZK-proven |



## Quick Start

### Design Principle## Contracts

```bash

# Install

npm install

**Smart contracts for protocol-critical state only.** Bitcoin awareness and finality tracking are handled off-chain:| Contract | Description |

# Compile (targets Shanghai EVM -- Citrea requirement)

npx hardhat compile|----------|-------------|



# Run tests (8 passing)| Layer | Approach || `BINSTDeployer` | Factory/registry — deploys and indexes process templates |

npx hardhat test

|-------|----------|| `ProcessTemplate` | Immutable blueprint with named steps (adapted from DeBu Studio) |

# Run full demo (local) -- Institution -> Process -> Instance flow

npx hardhat run scripts/demo-flow.ts| **Protocol state** (processes, steps, registry) | On-chain contracts — source of truth for webapp || `ProcessInstance` | Running execution with step-by-step state tracking |



# Deploy to Citrea Testnet| **Bitcoin block hashes** | Direct `eth_call` to Light Client `0x3100...0001` — free, no wrapper needed || `BitcoinAnchor` | Reads Citrea's Bitcoin Light Client to anchor process events to BTC |

cp .env.example .env  # Add your private key

npx hardhat run scripts/demo-flow.ts --network citreaTestnet| **Finality tracking** (committed / ZK-proven) | Off-chain monitor polling Citrea RPCs |



# Bitcoin awareness (no deployment needed)| **Bridge awareness** (deposits, withdrawals) | Off-chain indexing of Bridge events at `0x3100...0002` |## Quick Start

npx tsx scripts/bitcoin-awareness.ts



# Monitor finality for a specific L2 block

WATCH_L2=23972426 npx tsx scripts/finality-monitor.ts## Contracts```bash

```

# Install

## Citrea Testnet Config

| Contract | Description |npm install

| Setting | Value |

|---------|-------||----------|-------------|

| RPC | `https://rpc.testnet.citrea.xyz` |

| Chain ID | `5115` || `BINSTDeployer` | Factory/registry — deploys and indexes process templates |# Compile (targets Shanghai EVM — Citrea requirement)

| EVM | Shanghai (no Cancun) |

| Currency | cBTC || `ProcessTemplate` | Immutable blueprint with named steps (adapted from DeBu Studio) |npx hardhat compile

| Faucet | Citrea Discord `#faucet` |

| Explorer | `https://explorer.testnet.citrea.xyz` || `ProcessInstance` | Running execution with step-by-step state tracking |



## Bitcoin Anchoring -- How It Works# Run tests



BINST does **not** deploy a "Bitcoin anchor" contract. Instead, it relies on Citrea's existing infrastructure:## Off-chain Bitcoin Toolingnpx hardhat test



1. **Every BINST transaction** lives in a specific Citrea L2 block

2. **Citrea's sequencer** batches L2 blocks and inscribes a **Sequencer Commitment** (Merkle root) on Bitcoin -- this pins the ordering

3. **Citrea's batch prover** generates a **ZK proof (Groth16 via RISC Zero)** attesting to correct execution, and inscribes it on Bitcoin with **state diffs**| Script | Description |# Run full demo (local)

4. After step 3, **anyone with a Bitcoin node can reconstruct the entire Citrea state** -- including all BINST data

|--------|-------------|npx hardhat run scripts/demo-flow.ts

**Finality model:**

| `scripts/bitcoin-awareness.ts` | Reads Light Client, queries finality RPCs, finds commitments & proofs |

| Level | What happens | How to verify |

|-------|-------------|---------------|| `scripts/finality-monitor.ts` | Polls Citrea RPCs until a watched L2 block is committed / ZK-proven |# Deploy to Citrea Testnet

| **Soft Confirmation** | Sequencer signs the L2 block | Transaction receipt |

| **Committed** | Sequencer commitment inscribed on Bitcoin | `citrea_getLastCommittedL2Height` RPC |cp .env.example .env  # Add your private key

| **ZK-Proven** | ZK batch proof inscribed on Bitcoin | `citrea_getLastProvenL2Height` RPC |

## Quick Startnpx hardhat run scripts/demo-flow.ts --network citreaTestnet

The off-chain `finality-monitor.ts` script watches these RPCs and reports when your L2 blocks reach each milestone.

```

## Clementine Bridge (BTC <-> cBTC)

```bash

Users interact with BINST using **cBTC** -- BTC that has been trust-minimally bridged via Clementine (BitVM2-based, 1-of-N honesty assumption):

# Install## Citrea Testnet Config

- **Peg-in (BTC -> cBTC):** Send BTC to Taproot deposit address -> Signers move to vault -> Bridge mints cBTC

- **Peg-out (cBTC -> BTC):** Burn cBTC via `safeWithdraw()` -> Operator pays BTC -> Challenge window -> Donenpm install



cBTC is not a wrapped token -- it is BTC secured by BitVM2's optimistic verification of ZK proofs directly on Bitcoin.| Setting | Value |



## Tech Stack# Compile (targets Shanghai EVM — Citrea requirement)|---------|-------|



- **Hardhat 3** with Viem (not ethers)npx hardhat compile| RPC | `https://rpc.testnet.citrea.xyz` |

- **Solidity 0.8.24** targeting Shanghai EVM

- **TypeScript** (ESM)| Chain ID | `5115` |

- **Citrea Testnet** (Bitcoin Testnet4 DA layer)

# Run tests (5 passing)| EVM | Shanghai (no Cancun) |

## Part of BINST

npx hardhat test| Currency | cBTC |

This pilot is part of the [Bitcoin Institutions (BINST)](https://github.com/Bitcoin-Institutions/BINST) protocol -- bringing institutional-grade processes to Bitcoin through ZK rollups and trust-minimized bridges.

| Faucet | Citrea Discord `#faucet` |

# Run full demo (local)| Explorer | `https://explorer.testnet.citrea.xyz` |

npx hardhat run scripts/demo-flow.ts

## Bitcoin Anchoring

# Deploy to Citrea Testnet

cp .env.example .env  # Add your private keyThe `BitcoinAnchor` contract reads from Citrea's **Bitcoin Light Client** system contract (`0x3100000000000000000000000000000000000001`), which stores Bitcoin block hashes as they're confirmed.

npx hardhat run scripts/demo-flow.ts --network citreaTestnet

**Finality model:**

# Bitcoin awareness (no deployment needed)1. **Soft Confirmation** — sequencer processes the transaction

npx tsx scripts/bitcoin-awareness.ts2. **Finalized** — sequencer commitment inscribed on Bitcoin

3. **Proven** — ZK batch proof inscribed on Bitcoin (strongest guarantee)

# Monitor finality for a specific L2 block

WATCH_L2=23972426 npx tsx scripts/finality-monitor.tsThis means every process step executed on BINST is provably committed to Bitcoin's immutable ledger.

```

## Tech Stack

## Citrea Testnet Config

- **Hardhat 3** with Viem (not ethers)

| Setting | Value |- **Solidity 0.8.24** targeting Shanghai EVM

|---------|-------|- **TypeScript** (ESM)

| RPC | `https://rpc.testnet.citrea.xyz` |- **Citrea Testnet** (Bitcoin Testnet4 DA layer)

| Chain ID | `5115` |

| EVM | Shanghai (no Cancun) |## Part of BINST

| Currency | cBTC |

| Faucet | Citrea Discord `#faucet` |This pilot is part of the [Bitcoin Institutions (BINST)](https://github.com/Bitcoin-Institutions/BINST) protocol — bringing institutional-grade processes to Bitcoin through ZK rollups and trust-minimized bridges.

| Explorer | `https://explorer.testnet.citrea.xyz` |

## Bitcoin Anchoring — How It Works

BINST does **not** deploy a "Bitcoin anchor" contract. Instead, it relies on Citrea's existing infrastructure:

1. **Every BINST transaction** lives in a specific Citrea L2 block
2. **Citrea's sequencer** batches L2 blocks and inscribes a **Sequencer Commitment** (Merkle root) on Bitcoin — this pins the ordering
3. **Citrea's batch prover** generates a **ZK proof (Groth16 via RISC Zero)** attesting to correct execution, and inscribes it on Bitcoin with **state diffs**
4. After step 3, **anyone with a Bitcoin node can reconstruct the entire Citrea state** — including all BINST data

**Finality model:**

| Level | What happens | How to verify |
|-------|-------------|---------------|
| **Soft Confirmation** | Sequencer signs the L2 block | Transaction receipt |
| **Committed** | Sequencer commitment inscribed on Bitcoin | `citrea_getLastCommittedL2Height` RPC |
| **ZK-Proven** | ZK batch proof inscribed on Bitcoin | `citrea_getLastProvenL2Height` RPC |

The off-chain `finality-monitor.ts` script watches these RPCs and reports when your L2 blocks reach each milestone.

## Clementine Bridge (BTC ↔ cBTC)

Users interact with BINST using **cBTC** — BTC that has been trust-minimally bridged via Clementine (BitVM2-based, 1-of-N honesty assumption):

- **Peg-in (BTC → cBTC):** Send BTC to Taproot deposit address → Signers move to vault → Bridge mints cBTC
- **Peg-out (cBTC → BTC):** Burn cBTC via `safeWithdraw()` → Operator pays BTC → Challenge window → Done

cBTC is not a wrapped token — it's BTC secured by BitVM2's optimistic verification of ZK proofs directly on Bitcoin.

## Tech Stack

- **Hardhat 3** with Viem (not ethers)
- **Solidity 0.8.24** targeting Shanghai EVM
- **TypeScript** (ESM)
- **Citrea Testnet** (Bitcoin Testnet4 DA layer)

## Part of BINST

This pilot is part of the [Bitcoin Institutions (BINST)](https://github.com/Bitcoin-Institutions/BINST) protocol — bringing institutional-grade processes to Bitcoin through ZK rollups and trust-minimized bridges.
