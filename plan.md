# 🎯 BINST Pilot — Plan & Architecture Decisions

> **Goal:** Minimal implementation on Citrea Testnet demonstrating BINST protocol activity cryptographically anchored to Bitcoin via ZK proofs.

---

## Why Citrea

1. **Fully EVM-compatible** — Citrea says it explicitly: *"The deployment of your EVM smart contracts is as easy as changing the RPC endpoint."* The three DeBu contracts (`DeBuDeployer.sol`, `ProcessTemplate.sol`, `ProcessInstance.sol`) can deploy **as-is** with zero modifications.

2. **Bitcoin Light Client at `0x3100...0001`** — System contract that ingests every finalized Bitcoin block (block hash + witness root). Our contracts can **read Bitcoin block hashes on-chain** and verify Bitcoin transaction inclusion via Merkle proofs. This is the "proof that our activity is reflected on Bitcoin."

3. **Clementine Bridge (BitVM2-based)** — The Citrea ↔ Bitcoin bridge uses BitVM2 for trust-minimized peg-in/peg-out. This is the 3rd-gen bridge described in the BINST README.

4. **Schnorr precompile at `0x...0200`** — Native BIP-340 Schnorr signature verifier. Bitcoin-native cryptography available to Solidity contracts — can verify Taproot signatures from within the EVM. No other L2 offers this.

5. **Three layers of finality** — Soft confirmations → Finalized (sequencer commitment inscribed on Bitcoin) → Proven (ZK proof inscribed on Bitcoin). Protocol activity literally gets a ZK proof posted to Bitcoin.

6. **Testnet uses Bitcoin Testnet4 as DA** — The testnet posts real data to Bitcoin Testnet4, so the demo is not simulated.

---

## Decision: Dismiss Scaffold-ETH

**Protocol-first, no frontend for the pilot.**

| Scaffold-ETH | Protocol-First Approach |
|---|---|
| Pulls in a massive Ethereum-centric stack (Next.js, wagmi, viem, RainbowKit) | Clean, minimal project focused on what matters |
| Opinionated folder structure designed for Ethereum dapps | Structure tailored to BINST's specific architecture |
| Embeds Ethereum branding, terminology, UX patterns throughout | Bitcoin-aligned framing from day one |
| Hard to remove later — it shapes everything | Nothing to remove |
| Great for hackathons, wrong for a protocol pilot | Protocol-first is right for proving the concept |

A webapp can come later (Phase 2). The quick-win is **proving the protocol works on Bitcoin-anchored infrastructure**, not building a UI.

---

## The Quick-Win: What We're Demonstrating

The pilot proves this chain of guarantees:

```
Deploy DeBu contracts on Citrea Testnet
        ↓
Create an institution, deploy a process, execute steps
        ↓
Citrea sequencer batches these transactions
        ↓
Sequencer commitment inscribed on Bitcoin Testnet4
        ↓
ZK batch proof inscribed on Bitcoin Testnet4
        ↓
✅ Protocol activity is cryptographically proven on Bitcoin
```

**Bonus quick-win**: Use the Bitcoin Light Client (`0x3100...0001`) from within our contracts to read the Bitcoin block hash where our own batch was finalized — a contract that can prove awareness of its own Bitcoin settlement.

---

## Project Structure

```
binst-pilot/
├── README.md                    # Project overview, quick-win goal, how to run
├── LICENSE                      # MIT (already exists)
├── .gitignore
├── .env.example                 # RPC URL, private key template
├── hardhat.config.ts            # Citrea testnet network config
├── package.json
├── tsconfig.json
│
├── contracts/
│   ├── process/                 # DeBu contracts adapted for BINST
│   │   ├── ProcessTemplate.sol
│   │   ├── ProcessInstance.sol
│   │   └── BINSTDeployer.sol    # Renamed from DeBuDeployer
│   │
│   ├── institution/             # New Institution Layer
│   │   ├── IInstitution.sol     # Interface
│   │   └── Institution.sol      # Minimal: name, members, process binding
│   │
│   └── bitcoin/                 # Bitcoin-aware contracts
│       └── BitcoinAnchor.sol    # Reads from Citrea's Light Client
│
├── scripts/
│   ├── deploy.ts                # Deploy all contracts to Citrea testnet
│   ├── demo-flow.ts             # Full demo: create institution → deploy process → execute steps
│   └── verify-bitcoin.ts        # Query the light client to show Bitcoin anchoring
│
├── test/
│   └── BINSTProtocol.test.ts    # Full integration tests
│
└── docs/
    └── pilot-architecture.md    # Architecture decisions and Citrea integration notes
```

---

## Key Decisions

### 1. Hardhat + TypeScript (not Foundry)

- Already known from DeBu development
- Citrea's official docs are Hardhat-first
- TypeScript for scripts/tests keeps it clean
- Foundry (Solidity-only testing) would be overkill for a pilot

### 2. No Frontend

- Scripts demonstrate the protocol via CLI
- A CLI-style demo is more convincing for the pilot than a half-baked UI
- Frontend is Phase 2 work

### 3. No `BitcoinAnchor.sol` or `FinalityOracle.sol` — off-chain tooling instead

**Principle: smart contracts for protocol-critical state only.**

Everything BitcoinAnchor stored on-chain (BTC block hash, L2 block, timestamp,
metadata) is already available from:
- The transaction receipt (L2 block number, timestamp)
- The Light Client at `0x3100...0001` via free `eth_call` (BTC block hash)
- Citrea RPCs (`citrea_getLastCommittedL2Height`, `citrea_getLastProvenL2Height`)

FinalityOracle was a permissioned write of data anyone can query from the RPC.
Neither contract is read by any other contract in the protocol. They only
existed for external visibility — which a webapp or indexer handles better.

**What replaced them:**
- `scripts/bitcoin-awareness.ts` — reads Light Client + finality RPCs directly
- `scripts/finality-monitor.ts` — polls RPCs, reports when L2 blocks are committed/proven
- Future webapp will do `eth_call` to Light Client and index `ProcessInstance` events

### 4. Minimal Institution Layer

Not the full governance system from the project plan. Just enough to prove: an institution exists, it owns processes, and processes are bound to it.

### 5. `BINSTDeployer.sol` (renamed from `DeBuDeployer.sol`)

Modified to require an institution address when deploying a process — the key BINST addition that binds processes to institutions.

---

## Citrea Testnet Configuration

| Config | Value |
|---|---|
| RPC URL | `https://rpc.testnet.citrea.xyz` |
| Chain ID | `5115` |
| Bitcoin DA Layer | Bitcoin Testnet4 |
| Block Explorer | Citrea Testnet Explorer |
| Bitcoin Light Client | `0x3100000000000000000000000000000000000001` |
| Bridge Contract | `0x3100000000000000000000000000000000000002` |
| Schnorr Precompile | `0x0000000000000000000000000000000000000200` |
| secp256r1 Precompile | `0x0000000000000000000000000000000000000100` |
| Bitcoin Finality Depth | 100 confirmations (testnet) |

---

## 🖥️ Infrastructure

### The Big Picture

There are three layers in play, and for each you need to decide: run your own, or use a public endpoint?

```
┌──────────────────────────────────────────────────────┐
│  YOUR DEV MACHINE (macOS)                            │
│  ┌────────────────────────────────────────────────┐  │
│  │  Hardhat project (contracts, scripts, tests)   │  │
│  │  Talks to Citrea testnet via public RPC        │  │
│  └──────────────────┬─────────────────────────────┘  │
│                     │ JSON-RPC                        │
│                     ▼                                 │
│  ┌────────────────────────────────────────────────┐  │
│  │  CITREA TESTNET (L2)              [REMOTE]     │  │
│  │  Public RPC: rpc.testnet.citrea.xyz            │  │
│  │  System contracts: Light Client, Bridge        │  │
│  │  Sequencer batches txns → inscribes on BTC     │  │
│  └──────────────────┬─────────────────────────────┘  │
│                     │ DA Layer                        │
│                     ▼                                 │
│  ┌────────────────────────────────────────────────┐  │
│  │  BITCOIN TESTNET4 (L1)            [REMOTE]     │  │
│  │  Sequencer commitments + ZK proofs inscribed   │  │
│  │  Light client mirrors block hashes into Citrea │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

### 1. Bitcoin Testnet4 Node — NOT NEEDED

**Your signet node at home does not help here.** Citrea testnet uses Bitcoin Testnet4 (not signet) as its DA layer. However:

- **You do NOT need to run a Testnet4 node for the pilot.** The Citrea sequencer handles all Bitcoin interaction (inscribing commitments, posting proofs, feeding block hashes to the Light Client contract). Your smart contracts interact with Bitcoin data through Citrea's on-chain Light Client (`0x3100...0001`), not by talking to a Bitcoin node directly.
- **When would you need one?** Only if you want to run a Citrea full node yourself (the Citrea node needs a synced Testnet4 node as its backend). For the pilot, the public RPC is sufficient.
- **Requirements if you ever run one:** Bitcoin Core v30.2+, `bitcoind -testnet4 -txindex=1`, ~50 GB disk, full sync takes several hours.

**Verdict: Skip for now. ⏭️**

### 2. Citrea Node — NOT NEEDED (for the pilot)

**You do NOT need to run a Citrea full node.** Citrea provides a public testnet RPC at `https://rpc.testnet.citrea.xyz` that supports:
- All standard `eth_*` JSON-RPC methods (what Hardhat uses to deploy and interact with contracts)
- Citrea-specific endpoints: `citrea_syncStatus`, `citrea_getLastCommittedL2Height`, `citrea_getLastProvenL2Height`
- Ledger endpoints: `ledger_getSequencerCommitmentsOnSlotByNumber`, `ledger_getVerifiedBatchProofsBySlotHeight`

The public RPC is exactly what Citrea's own deployment guides use. All their Hardhat configuration examples point to `https://rpc.testnet.citrea.xyz`.

**When would you need one?** 
- If the public RPC has rate limits that block your development
- If you need to query Citrea-specific RPCs that might not be exposed publicly
- If you want to independently verify batch proofs (but the public node does this anyway)

**Citrea full node requirements (if ever needed):** 8 GB RAM, 2 TB SSD, 4-core CPU, plus a synced Bitcoin Testnet4 node as backend. Docker or binary install.

**Verdict: Skip for now. Use public RPC. ⏭️**

### 3. What You DO Need

| Component | Purpose | How |
|---|---|---|
| **Node.js** (v18+) | Hardhat runtime | `brew install node` or already installed |
| **MetaMask or similar wallet** | Manage your Citrea testnet account | Browser extension, add Citrea testnet network |
| **Citrea testnet cBTC** | Gas for deploying and calling contracts | Faucet or bridge (see below) |
| **A private key for Hardhat** | Signs deploy transactions from scripts | Generate a fresh one, never use mainnet keys |
| **Git** | Version control for binst-pilot | Already have it |

### 4. Getting Testnet cBTC (Gas)

This is the only infrastructure dependency that requires action. You need cBTC on Citrea testnet to pay for contract deployments and interactions. Options:

1. **Citrea Discord faucet** — Join [Citrea Discord](https://discord.gg/citrea) and look for a faucet channel. This is the standard path for testnet tokens.
2. **Bridge from Bitcoin Testnet4** — If you can get Testnet4 BTC, you can bridge via Clementine (10 BTC minimum) or third-party bridges. But this requires a Testnet4 wallet, which is more work than the faucet.
3. **Ask in Discord** — Citrea team is active and helpful for developers building on testnet.

> ⚠️ **Action item before we start coding:** Get some testnet cBTC. Everything else is ready.

### 5. EVM Version Consideration

**Important from the Citrea docs:** Citrea does not support the Cancun EVM upgrade. When deploying contracts, you must target the **Shanghai** EVM version. In Hardhat config:

```typescript
solidity: {
  version: "0.8.24",
  settings: {
    evmVersion: "shanghai",  // NOT "cancun" — Citrea doesn't support it
    optimizer: { enabled: true, runs: 200 }
  }
}
```

This affects the Hardhat config we'll create. If you compile with default (Cancun) settings, you may get opcode errors on deployment.

### 6. Verifying Bitcoin Anchoring (the Demo Payoff)

After deploying and running the protocol on Citrea testnet, we can use Citrea's custom RPCs to demonstrate the Bitcoin anchoring without running any Bitcoin node:

```bash
# What's the latest L2 height committed to Bitcoin?
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"citrea_getLastCommittedL2Height","params":[],"id":1}' \
  https://rpc.testnet.citrea.xyz

# What's the latest L2 height with a ZK proof on Bitcoin?
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"citrea_getLastProvenL2Height","params":[],"id":1}' \
  https://rpc.testnet.citrea.xyz

# Get the sequencer commitment for a specific Bitcoin block
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"ledger_getSequencerCommitmentsOnSlotByNumber","params":[BITCOIN_BLOCK_HEIGHT],"id":1}' \
  https://rpc.testnet.citrea.xyz

# Get the actual ZK batch proof posted at a Bitcoin block
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"ledger_getVerifiedBatchProofsBySlotHeight","params":[BITCOIN_BLOCK_HEIGHT],"id":1}' \
  https://rpc.testnet.citrea.xyz
```

Plus, our `BitcoinAnchor.sol` contract calls the Light Client directly from Solidity to read Bitcoin block hashes — proving the on-chain connection.

### 7. Infrastructure Summary

| Layer | Run Your Own? | What We Use Instead |
|---|---|---|
| **Bitcoin Testnet4** | ❌ No | Citrea sequencer handles Bitcoin interaction; Light Client exposes data on-chain |
| **Citrea Testnet Node** | ❌ No | Public RPC at `https://rpc.testnet.citrea.xyz` |
| **Bitcoin Signet (your existing node)** | ❌ Not applicable | Different network; Citrea uses Testnet4 |
| **Development Environment** | ✅ Your machine | Node.js + Hardhat + TypeScript |
| **Wallet** | ✅ MetaMask | With Citrea testnet network added |
| **Testnet funds** | ✅ Need cBTC | Citrea Discord faucet |

> **Bottom line: The pilot requires zero infrastructure beyond your dev machine, a wallet, and testnet cBTC.** Everything else is handled by Citrea's public endpoints and system contracts. This is the beauty of building on an L2 — all the heavy lifting (Bitcoin DA, ZK proofs, batch posting) is done by the sequencer, and you interact with it through standard EVM tooling.

---

## Citrea System Contracts (Reference)

### Bitcoin Light Client (`0x3100...0001`)
- Ingests every finalized Bitcoin block via system transactions
- Stores: `blockNumber`, `blockHashes[height]`, `witnessRoots[blockHash]`, `coinbaseDepths[blockHash]`
- Provides `verifyInclusion(blockHash, wtxId, proof, index)` for Merkle proof verification
- Only system caller can mutate state — fully deterministic
- Hashes are little-endian

### Bridge (`0x3100...0002`)
- Clementine bridge: BTC ↔ cBTC
- Deposit flow: user sends BTC → Signers move to vault → Bridge mints cBTC on Citrea
- Withdrawal flow: user burns cBTC → Operator pays BTC → Operator claims reimbursement
- 1-of-N honesty assumption (trust-minimized)
- Uses Schnorr precompile for Taproot signature verification

### Schnorr Precompile (`0x...0200`)
- BIP-340 Schnorr signature verification
- Input: pubKeyX (32 bytes) | messageHash (32 bytes) | signature (64 bytes)
- Gas cost: 4600
- Enables: scriptless atomic swaps, Bitcoin-aware oracles, Taproot signature verification

---

## Implementation Steps

| Step | Action | Status |
|---|---|---|
| **1** | Initialize Hardhat project with TypeScript | ✅ |
| **2** | Configure for Citrea testnet (RPC, Chain ID 5115) | ✅ |
| **3** | Port three DeBu contracts, rename `DeBuDeployer` → `BINSTDeployer` | ✅ |
| **4** | Add `BitcoinAnchor.sol` that reads from the Light Client | ✅ |
| **5** | Write deploy + demo scripts | ✅ |
| **6** | Deploy to Citrea testnet, verify all contracts | ✅ |
| **7** | Run live protocol test, anchor to real Bitcoin blocks | ✅ |
| **8** | Integrate Clementine bridge awareness + finality tracking | ⬜ |
| **9** | Add minimal `Institution.sol` (Phase 2) | ⬜ |
| **10** | Document everything in README | ⬜ |

---

## Clementine bridge, direct-Bitcoin usage, and finality interception

This section explains how Clementine (the BitVM2-based bridge), Citrea's rollup
pipeline, and the Bitcoin Light Client interact with BINST — and how to
programmatically confirm when BINST data is finalized and ZK-proven on Bitcoin.

High-level summary:
- Users and institutions interact with BINST on Citrea using cBTC and native
  Citrea accounts. cBTC is minted by the Clementine bridge when a Bitcoin
  peg-in completes; cBTC is redeemed back to BTC via bridge peg-outs.
- Citrea posts two important artifacts to Bitcoin: (a) Sequencer Commitments
  (ordering) and (b) ZK Batch Proofs + state diffs (validity). Both are
  retrievable via Citrea RPCs and on-chain Light Client state.
- We cannot "intercept" the sequencer's internal pipeline, but we can observe
  and verify its outputs (commitments and proofs) using Citrea RPCs and the
  Bitcoin Light Client. That is sufficient to prove our protocol data is
  cryptographically final on Bitcoin.

Peg-in / Peg-out (practical note):
- Peg-in (BTC → cBTC): user sends BTC (Taproot deposit) to Clementine's
  deposit address. After the required confirmations, the Bridge contract at
  `0x3100000000000000000000000000000000000002` validates the deposit via
  the Bitcoin Light Client and mints cBTC to the mapped Citrea address.
- Peg-out (cBTC → BTC): user burns cBTC (e.g. `safeWithdraw`) and then
  either waits for signers/operators to complete the payout, or an optimistic
  flow completes. Dispute/challenge mechanisms use BitVM and on-chain proofs
  on Bitcoin if needed.

Practical friction:
- Testnet: deposit confirmation depth is large (100 confirmations), and the
  Clementine peg-in amount is non-trivial (documented min is large on public
  docs). For developer flows use Citrea faucet for cBTC unless you need an
  actual peg-in test.

Programmatic confirmation that "our" L2 block is committed/proven on Bitcoin
1) Record the L2 block number when a BINST transaction executes (from the
   transaction receipt: `receipt.blockNumber`).
2) Poll Citrea RPCs until the committed/proven heights pass your L2 block:
   - `citrea_getLastCommittedL2Height` — ordering committed on Bitcoin
   - `citrea_getLastProvenL2Height` — ZK proof posted on Bitcoin
3) (Optional) Query Bitcoin block(s) that contain the sequencer commitment or
   batch proof that references your L2 block using:
   - `ledger_getSequencerCommitmentsOnSlotByNumber(btcHeight)`
   - `ledger_getVerifiedBatchProofsBySlotHeight(btcHeight)`
   Use these to map the commitment/proof to a Bitcoin transaction and
   timestamp.
4) (Optional on-chain confirm) Call a simple `FinalityOracle` on Citrea that
   you control to record that your L2 block is now `Committed` / `Proven`.

Suggested off-chain monitor (node.js, viem) — poll-and-confirm pattern
```js
// pseudocode
const { createPublicClient, http } = require('viem')
const client = createPublicClient({ transport: http(RPC_URL) })

async function waitForProven(l2Block) {
  while (true) {
    const proven = await client.request({ method: 'citrea_getLastProvenL2Height', params: [] })
    const provenH = typeof proven === 'object' ? (proven.height || proven) : proven
    if (Number(provenH) >= l2Block) return provenH
    await sleep(30_000)
  }
}
```

Design: small on-chain `FinalityOracle` (optional)
- Purpose: allow an off-chain prover to call `markProven(l2Block, btcHeight, proofRef)`
  after it's validated off-chain. The contract simply records the mapping and
  emits an event. This gives on-chain consumers a single source for whether a
  given process-event has reached a specific finality milestone. Keep it
  permissioned or meta-signed to avoid spam.

Security notes & guarantees
- You cannot modify the Bitcoin Light Client; only the system caller appends
  new block info. That means on-chain calls to `getBlockHash()` or
  `verifyInclusion()` are readers and rely on sequencer/system correctness.
- The canonical final proof of correctness is the ZK Batch Proof posted to
  Bitcoin. The `citrea_getLastProvenL2Height` RPC is the authoritative way to
  know the proven tip; corroborate with `ledger_getVerifiedBatchProofsBySlotHeight`.
- Force-inclusion mechanisms are planned (post-mainnet) which will allow
  users to post minimal L1 commitments on Bitcoin to force tx inclusion. This
  improves liveness in degenerate sequencer-failure cases.

How BINST can integrate Clementine deeply
- Accept cBTC as native payments for steps that require money movement.
- React to Bridge `Deposit` events to auto-provision institution accounts or
  trigger process instantiation for on-chain backed deposits. The Bridge emits
  `Deposit` with `depositId`, `wtxId`, `recipient`, and `timestamp` for
  reliable indexing.
- Use `verifyInclusion()` from the Light Client (via on-chain calls) when you
  need to cryptographically prove that a particular Bitcoin tx (e.g. a deposit
  or payout) was included in Bitcoin and recognized by Citrea.

Practical next steps (minimal scope):
1. Add `FinalityTracker` script and a tiny `FinalityOracle.sol` contract to
   `contracts/` (optional on-chain anchor for finality events).
2. Add `scripts/finality-monitor.ts` that: records L2 block numbers for key
   events, polls Citrea RPCs, and calls `FinalityOracle.markProven` when ready.
3. Wire Bridge deposit handling: example script shows how to index `Deposit`
   events from `0x3100...0002` and automatically mint or create process
   instances when a real peg-in is observed (developer mode).

These additions will let BINST "consume" Clementine functionality (peg-ins,
peg-outs) with minimal friction while providing programmatic confirmation when
the protocol's data becomes ZK-proven and replicated on Bitcoin.


## Source Contracts (DeBu Studio)

Original contracts from [DeBu Studio](https://github.com/diegobianqui/DeBu_studio/tree/main/debu_studio/packages/hardhat/contracts):

- **`DeBuDeployer.sol`** — Factory contract. Deploys `ProcessTemplate` instances, maintains registry, emits `ProcessDeployed` events.
- **`ProcessTemplate.sol`** — Immutable process blueprint. Stores steps (name, description, actionType, config). Can instantiate `ProcessInstance`. Tracks `instantiationCount` for meritocratic rankings.
- **`ProcessInstance.sol`** — Running execution of a template. Sequential step execution with state tracking (Pending/Completed/Rejected), actor recording, timestamps. Supports payment steps.

---

## Citrea Finality Model (Reference)

| Level | Description | Trust |
|---|---|---|
| **Soft Confirmation** | Sequencer-signed L2 block. Fast but mutable. | Sequencer signature |
| **Finalized** | Sequencer commitment (Merkle root of soft confirmations) inscribed on Bitcoin Testnet4 | Bitcoin PoW |
| **Proven** | ZK batch proof + state diffs inscribed on Bitcoin. Any node can rebuild state from Bitcoin alone. | Cryptographic proof + Bitcoin PoW |

> *"The rollup blocks are as secure as the Bitcoin proof-of-work that cemented its data and the cryptographic soundness of the zk-proof."* — Citrea docs
