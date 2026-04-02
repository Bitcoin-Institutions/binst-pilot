# DA Proof: ProcessInstance State on Bitcoin

## Summary

This document proves that the complete lifecycle of `ProcessInstance`
`0x2066B17e0e6bD9AB1bbC76A146f68eBfca7C6f4f` — deployment and all four
step executions — is permanently committed to **Bitcoin testnet4** via
Citrea's Data Availability (DA) layer.  No separate Ordinals inscription
was required.

**Key finding:** All five L2 transactions fit inside a single
SequencerCommitment at Bitcoin block **127 747**, txid
`ce8a015b670a47ade22cacba193cfbf5fba535752fb3c2c738bd2f7bcfc468c2`.

---

## 1. The L2 Transactions

| # | Action | L2 Block | Citrea Tx Hash (prefix) |
|---|--------|----------|-------------------------|
| 0 | Deploy ProcessInstance | 23 971 461 | `0x74335...` |
| 1 | executeStep (step 1) | 23 971 463 | `0x00b0e...` |
| 2 | executeStep (step 2) | 23 971 466 | `0x3317f...` |
| 3 | executeStep (step 3) | 23 971 469 | `0xda86a...` |
| 4 | executeStep (step 4 — completes) | 23 971 472 | `0x57c8e...` |

Created by: `0x8CF6fe5cd0905b6bFb81643b0DCda64Af32fd762`  
Template: `0x3A6A07C5D2C420331f68DD407AaFff92f3275a86`

## 2. Final On-Chain State (Citrea)

| Slot | Field | Raw Value | Decoded |
|------|-------|-----------|---------|
| 0 | template | `0x3A6A07C5D2C420331f68DD407AaFff92f3275a86` | `0x3a6a07c5d2c420331f68dd407aafff92f3275a86` |
| 1 | creator | `0x8CF6fe5cd0905b6bFb81643b0DCda64Af32fd762` | `0x8cf6fe5cd0905b6bfb81643b0dcda64af32fd762` |
| 2 | currentStepIndex | 4 | `4` |
| 3 | totalSteps | 4 | `4` |
| 4 | completed | `true` | `true` |
| 5 | createdAt | `0x69c88b6c` (1 774 750 572) | `1774750572` |

The **Decoded** column shows the output of the `binst-decoder` value module,
which reverses the Citrea LE word order and interprets each field according
to its Solidity type (address, uint256, bool, etc.).

## 3. The DA Commitment on Bitcoin

The Citrea sequencer posts SequencerCommitments to Bitcoin as tapscript
inscriptions.  Each commitment covers a range of ~1 000 L2 blocks and
includes a Merkle root over the committed batch data.

**SequencerCommitment covering our transactions:**

| Field | Value |
|-------|-------|
| Bitcoin block | **127 747** |
| Bitcoin txid | `ce8a015b670a47ade22cacba193cfbf5fba535752fb3c2c738bd2f7bcfc468c2` |
| Sequencer index | 16 697 |
| L2 end block | 23 972 028 |
| L2 range (computed) | 23 971 029 – 23 972 028 |
| Citrea DA pubkey | `015a7c4d2cc1c771198686e2ebef6fe7004f4136d61f6225b061d1bb9b821b9b` |

All five transactions (L2 blocks 23 971 461 – 23 971 472) fall within
this single commitment's range.

## 4. Batch Proofs (ZK Validity)

Multiple Complete batch proofs were also inscribed at Bitcoin block 127 747,
covering the same L2 range.  These proofs allow anyone to verify the
correctness of the state transitions without re-executing them.

Example batch proof txids at block 127 747:
- `f03860a10f24dd28ecaf...` (14 269 bytes)
- `060bde94f70bfb78af00...` (14 331 bytes)
- `efb3cfaa2c169acbc78c...` (26 774 bytes)
- `fb8d35f3c372a377c390...` (12 899 bytes)

## 5. The Full Reachability Chain

```
Bitcoin L1 (testnet4 block 127 747)
  └─ tx ce8a015b...  ← SequencerCommitment (seq_idx 16697)
       │                 covers L2 blocks 23,971,029 – 23,972,028
       │                 merkle_root over batch data
       │
       ├─ L2 block 23,971,461: CREATE2 → ProcessInstance 0x2066B17e...
       ├─ L2 block 23,971,463: executeStep(Completed, step 1 data)
       ├─ L2 block 23,971,466: executeStep(Completed, step 2 data)
       ├─ L2 block 23,971,469: executeStep(Completed, step 3 data)
       └─ L2 block 23,971,472: executeStep(Completed, step 4 data)
                                 → completed = true

  └─ tx f03860a1...  ← Complete batch proof (ZK validity proof)
       Verifies all state transitions in the covered range
```

## 6. Verification Steps

Anyone can independently verify this proof:

### Step A — Confirm the Bitcoin transaction exists

```bash
bitcoin-cli -testnet4 getrawtransaction \
  ce8a015b670a47ade22cacba193cfbf5fba535752fb3c2c738bd2f7bcfc468c2 1
```

### Step B — Decode the Citrea tapscript inscription

```bash
citrea-scanner --block 127747 --kind 4 --format json
# Look for sequencer_commitment.l2_end_block_number = 23972028
```

### Step C — Confirm the L2 transactions exist in that range

```bash
curl -s https://explorer.testnet.citrea.xyz/api/v2/transactions/0x7433558c901e634aeb137865953ba2462265df6bf8a5b3e2fe521dee97624410
# block_number: 23971461  ← within [23971029, 23972028] ✓
```

### Step D — Read the final state from the L2 contract

```bash
# Slot 4 (completed) should be 1 (true)
cast storage 0x2066B17e0e6bD9AB1bbC76A146f68eBfca7C6f4f 4 --rpc-url https://rpc.testnet.citrea.xyz
```

## 7. Cost Analysis

| Approach | Who Pays | Per-Instance Cost |
|----------|----------|-------------------|
| Individual inscription per ProcessInstance | User | ~$5.50 |
| **Bitcoin DA (this approach)** | **Sequencer** | **$0 (included in L2 fees)** |

At 1 000 instances, the DA approach saves ~$5 500 with zero loss of
Bitcoin-reachability.  The data is on Bitcoin L1 in both cases — the only
difference is that DA data is embedded in the Citrea sequencer's tapscript
inscriptions rather than in separate Ordinals inscriptions.

## 8. Architecture Decision

| Entity | Anchoring Method | Rationale |
|--------|-----------------|-----------|
| Institution | Ordinals inscription (parent) | Few, permanent, identity-defining |
| ProcessTemplate | Ordinals inscription (child of institution) | Few, immutable blueprint |
| **ProcessInstance** | **Bitcoin DA** | Many, mutable state, covered by sequencer |
| State Digest | Ordinals inscription (periodic) | Optional index, makes DA discoverable |

The ProcessInstance does **not** need its own inscription because:
1. Its state transitions are already committed to Bitcoin via DA
2. A ZK batch proof on Bitcoin validates those transitions
3. Anyone running `citrea-scanner` can trace from Bitcoin block to instance state
4. The state_digest (next section) makes this discoverable without scanning
