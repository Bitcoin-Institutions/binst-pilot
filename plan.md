# BINST Pilot — Plan & Architecture Decisions

> **Goal:** Proof-of-concept for Bitcoin-sovereign institutional processes.
> The Bitcoin key is the root of authority. L2 contracts are portable
> processing delegates. Identity lives on Bitcoin via Ordinals inscriptions.

---

## Design principles

1. **Bitcoin key = sovereign.** The holder of the private key that controls
   the inscription UTXO is the canonical authority. L2 contracts execute
   logic on their behalf.
2. **L2 = portable delegate.** If the user switches L2s they deploy a new
   contract bound to the same inscription ID. The identity is unchanged.
3. **Smart contracts for protocol-critical state only.** Bitcoin awareness,
   finality monitoring, and other read-only data live off-chain in scripts.
4. **Protocol-first, minimal frontend.** CLI scripts prove the protocol works.
   A Rust/WASM webapp decodes inscriptions; no full UI beyond that.

---

## Why Citrea (current L2)

| Feature | Why it matters |
|---------|---------------|
| Fully EVM-compatible | Solidity contracts deploy with a RPC endpoint change |
| Bitcoin Light Client (`0x3100…0001`) | Read Bitcoin block hashes on-chain, verify inclusion proofs |
| Schnorr precompile (`0x…0200`) | BIP-340 signature verification in Solidity — no other L2 offers this |
| Clementine Bridge (BitVM2) | Trust-minimized BTC ↔ cBTC peg |
| Testnet uses Bitcoin Testnet4 as DA | Real Bitcoin data, not simulated |
| Three finality levels | Soft confirmation → Committed → ZK-proven on Bitcoin |

The L2 choice is explicitly **non-permanent**. The architecture allows
migrating to any EVM-compatible L2 (Stacks, BOB, etc.) by redeploying
contracts and pointing them at the same inscription.

---

## What has been built

### Solidity contracts (Hardhat 3, Solidity 0.8.24 Shanghai)

| Contract | Purpose | Status |
|----------|---------|--------|
| `BINSTDeployer` | Factory/registry — creates institutions and deploys process templates | ✅ Deployed + verified on Citrea testnet |
| `Institution` | Institution entity — members, admin, Bitcoin identity (`inscriptionId`, `runeId`) | ✅ Deployed + verified |
| `ProcessTemplate` | Immutable workflow blueprint with named steps | ✅ Deployed + verified |
| `ProcessInstance` | Running execution with step-by-step state tracking, payments | ✅ Deployed + verified |

12 tests passing (Hardhat, `node:test`).

### Taproot Reader (Rust workspace, 4 crates)

| Crate | Purpose | Status |
|-------|---------|--------|
| `citrea-decoder` | Parses Citrea DA inscriptions from raw tapscript witness | ✅ 2 tests |
| `binst-decoder` | Maps L2 storage slot diffs → BINST entities (`BitcoinIdentity`, `InstitutionState`, etc.) | ✅ 5 tests |
| `binst-inscription` | Parses Ordinals envelopes for `binst` metaprotocol inscriptions | ✅ 9 tests |
| `cli` (`citrea-scanner`) | Connects to Bitcoin Core RPC, scans for Citrea DA transactions | ✅ tested live (16 inscriptions in 50 blocks) |

16 tests passing (`cargo test`).

### WASM Webapp

| Component | Purpose | Status |
|-----------|---------|--------|
| `binst-pilot-webapp` | Rust/WASM inscription decoder (JSON body + witness hex) | ✅ 148 KB release build |

Built with Trunk, reuses `binst-inscription` crate via path dependency.
Two decode modes: JSON body parse and raw witness hex envelope extraction.

### Live Inscriptions (Bitcoin testnet4)

| Entity | Inscription ID | Parent | Fees |
|--------|---------------|--------|------|
| Institution "BINST Pilot Institution" | `9fc9870038becdae3b9a654ccdfcea9b90108cd098c06098fd34f5af55247511i0` | — (root) | 3,470 sats |
| ProcessTemplate "Document Approval" | `f8f39d0e3cebf5a7d7ee772307ae0517bad9f8a82c8812376628bbc8c413a3c4i0` | `9fc987…i0` | 4,960 sats |

- **Admin pubkey:** `79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798`
- **Citrea contract:** `0x46c505d38e9009a16398f268e26dff6844ef59d5`
- **Metaprotocol:** `binst`
- **Postage:** 546 sats (sat isolation)

### Scripts

| Script | Purpose |
|--------|---------|
| `demo-flow.ts` | End-to-end: deploy → institution → members → process → execute all steps |
| `inscribe-binst.ts` | Generate `ord` commands to inscribe BINST entities on Bitcoin testnet4 |
| `taproot-vault.ts` | Build Taproot leaf scripts for inscription UTXO safety (NUMS + CSV + multisig) |
| `bitcoin-awareness.ts` | Read Bitcoin Light Client, query finality RPCs |
| `finality-monitor.ts` | Poll Citrea RPCs until a watched L2 block is committed / ZK-proven |
| `test-protocol.ts` | Query live deployed contracts on Citrea testnet |

### Documentation

| Document | Purpose |
|----------|---------|
| `BITCOIN-IDENTITY.md` | Full architecture: authority model, Taproot vault, lock/unlock flows, phase roadmap |
| `conceptual.md` | Non-technical overview of the three-layer architecture |
| `DECODING.md` | Technical reference for Citrea DA transaction decoding |
| `schema/README.md` | BINST metaprotocol JSON schema (4 entity types) with examples |

### JSON Schema

`taproot-reader/schema/binst-metaprotocol.json` — JSON Schema 2020-12 for
`institution`, `process_template`, `process_instance`, `step_execution`.
Reference payloads in `schema/examples/`.

---

## Implementation progress

| Phase | Description | Status |
|-------|-------------|--------|
| **0** | Hardhat project, 4 Solidity contracts, deploy to Citrea testnet, verify, 14 tests | ✅ |
| **1** | Inscription identity: JSON schema, `binst-inscription` crate, Solidity `inscriptionId`/`runeId` fields, Taproot vault script, inscription CLI | ✅ |
| **1b** | Authority model flip: Bitcoin key = sovereign, L2 = delegate, `bitcoin_pubkey` required in Rust structs, L2 portability docs | ✅ |
| **2** | Bitcoin-key sovereignty in Solidity: `btcPubkey` field, BTC→EVM derivation for trustless binding, live inscription on testnet4, WASM webapp | ✅ |
| **3** | Membership Runes + cross-chain sync: etch Rune, mint/distribute, LayerZero V2 relay (`BINSTRelay.sol` OApp), read-only mirrors on other L2s, batch BTC-side operations | ⬜ |
| **4** | Bitcoin-native discovery + unified wallet: `binst` indexer, member queries via Rune balances, Schnorr-verified single-wallet UX, cross-chain process verification via Bitcoin DA | ⬜ |
| **5** | Deep Bitcoin integration: covenant vaults (OP_CTV/OP_CAT), MuSig2 admin, Rune-gated access, BitVM verification | ⬜ |

See `BITCOIN-IDENTITY.md` § "Implementation phases" for full details.

---

## Infrastructure

### What we run

| Component | Details |
|-----------|---------|
| **Dev machine** (macOS) | Node.js 22+, Rust 1.94, Hardhat 3.2, `ord` 0.27 |
| **Bitcoin Core testnet4** | Remote node via SSH tunnel, `rpc:48332`, fully synced |
| **`ord` index** | Local, syncing against testnet4 node |
| **Citrea testnet** | Public RPC `https://rpc.testnet.citrea.xyz`, chain 5115 |

### Citrea system contracts

| Contract | Address |
|----------|---------|
| Bitcoin Light Client | `0x3100000000000000000000000000000000000001` |
| Clementine Bridge | `0x3100000000000000000000000000000000000002` |
| Schnorr Precompile (BIP-340) | `0x0000000000000000000000000000000000000200` |

### Citrea finality model

| Level | What happens | How to verify |
|-------|-------------|---------------|
| **Soft Confirmation** | Sequencer signs the L2 block | Transaction receipt |
| **Committed** | Sequencer commitment inscribed on Bitcoin | `citrea_getLastCommittedL2Height` |
| **ZK-Proven** | ZK batch proof inscribed on Bitcoin | `citrea_getLastProvenL2Height` |

### EVM version

Citrea does not support the Cancun upgrade. Target **Shanghai**:

```typescript
solidity: {
  version: "0.8.24",
  settings: { evmVersion: "shanghai", optimizer: { enabled: true, runs: 200 } }
}
```

---

## Key architecture decisions

### 1. Hardhat + TypeScript (not Foundry)
Citrea docs are Hardhat-first. TypeScript scripts/tests keep things clean.
Hardhat 3 uses Viem (not ethers).

### 2. No `BitcoinAnchor.sol` — off-chain tooling instead
Smart contracts for protocol-critical state only. Bitcoin awareness is
off-chain via direct `eth_call` to the Light Client and Citrea RPCs.
Scripts: `bitcoin-awareness.ts`, `finality-monitor.ts`.

### 3. Minimal frontend — WASM decoder only
A Rust/WASM webapp reuses the `binst-inscription` crate to decode
inscriptions in-browser. No full UI or wallet integration in the pilot.

### 4. Authority lives on Bitcoin, not on L2
The `Institution.sol` contract stores `inscriptionId` and `runeId` as
links back to Bitcoin. The contract is a delegate, not the authority.
See `BITCOIN-IDENTITY.md` for the full model.

### 5. Cross-chain sync: dual-channel model
Identity and membership sync across L2s via **LayerZero V2** (real-time,
Citrea endpoint live at chain 4114). Execution state verification uses
**Bitcoin DA** (trustless, ZK-proven batch proofs). Process instances
have a **single home chain** — mirrors are read-only. This prevents
concurrent mutation conflicts without needing rollback mechanisms.
See `BITCOIN-IDENTITY.md` § "Cross-chain state synchronization".

### 6. Institution anchoring is progressive, not mandatory
An institution can exist on the L2 without a Bitcoin inscription (UNANCHORED
state). Batch proofs still reach Bitcoin DA as "orphan proofs" — valid but
unlinked to a Bitcoin identity. Inscription elevates trust, not enables
function. See `BITCOIN-IDENTITY.md` § "Institution anchoring lifecycle".

### 7. Two wallets today, one wallet future
Current UX requires a Bitcoin wallet (Xverse/Unisat) for inscriptions/runes
and an EVM wallet (MetaMask) for L2 transactions. Future: Schnorr-verified
sessions via account abstraction enable a single Bitcoin wallet for both.

---

## Clementine bridge notes

- **Peg-in** (BTC → cBTC): user sends BTC to Clementine deposit address →
  Bridge contract validates via Light Client → mints cBTC.
- **Peg-out** (cBTC → BTC): user burns cBTC → operator pays BTC →
  dispute via BitVM if needed.
- **Testnet friction**: 100-confirmation depth, non-trivial minimum deposit.
  Use Citrea Discord faucet for cBTC during development.
- **BINST integration**: accept cBTC for payment steps, react to Bridge
  `Deposit` events, use `verifyInclusion()` for Bitcoin tx proofs.

---

## Origin

The process contracts descend from
[DeBu Studio](https://github.com/diegobianqui/DeBu_studio) (`DeBuDeployer`,
`ProcessTemplate`, `ProcessInstance`). BINST added the institution layer,
Bitcoin identity binding, and the sovereignty model.
