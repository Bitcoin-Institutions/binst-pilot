/**
 * psbt-transfer.ts — Atomic Institution Transfer via PSBT
 *
 * Generates the `bitcoin-cli` commands to construct a PSBT (BIP 174/371)
 * for an atomic multi-vault institution transfer.
 *
 * This is the SPENDING side of the vault — the companion to taproot-vault.ts
 * which builds the LOCKING scripts.
 *
 * Flow:
 *   1. List all vault UTXOs belonging to the institution (inscription + children)
 *   2. Build a single transaction spending all of them (atomicity)
 *   3. Output as a PSBT for offline signing / co-signing
 *
 * The script outputs bitcoin-cli commands because:
 *   - PSBT construction is best done by Bitcoin Core (trusted, audited)
 *   - The admin/committee can inspect the PSBT before signing
 *   - No Node.js Bitcoin TX library needed in production
 *
 * Usage:
 *   npx tsx scripts/psbt-transfer.ts <path_json>
 *
 * Where path_json is a file like:
 *   {
 *     "vaultUtxos": [
 *       { "txid": "abc123...", "vout": 0, "sats": 546, "label": "Institution" },
 *       { "txid": "def456...", "vout": 0, "sats": 546, "label": "Template: KYC" }
 *     ],
 *     "feeUtxo": { "txid": "fee789...", "vout": 1, "sats": 50000 },
 *     "newVaultAddress": "tb1p...",
 *     "changeAddress": "tb1q...",
 *     "feeRate": 10,
 *     "leaf": 0
 *   }
 *
 * Prerequisites:
 *   - Bitcoin Core (bitcoin-cli) or compatible RPC
 *   - Vault UTXOs identified via `ord wallet inscriptions` or block explorer
 */

import * as fs from "fs";

// ── Types ────────────────────────────────────────────────────────

interface VaultUtxo {
  txid: string;
  vout: number;
  sats: number;
  label: string;
}

interface TransferSpec {
  vaultUtxos: VaultUtxo[];
  feeUtxo: { txid: string; vout: number; sats: number };
  newVaultAddress: string;
  changeAddress: string;
  feeRate: number;
  leaf: 0 | 1; // 0 = admin (CSV), 1 = committee (immediate)
}

// ── Helpers ──────────────────────────────────────────────────────

function estimateTxSize(numInputs: number, numOutputs: number): number {
  // Rough Taproot script-path spend estimate:
  //   ~58 bytes overhead + ~100 bytes per input (witness) + ~43 bytes per output
  return 58 + numInputs * 100 + numOutputs * 43;
}

function estimateFee(numInputs: number, numOutputs: number, feeRate: number): number {
  const vsize = estimateTxSize(numInputs, numOutputs);
  return vsize * feeRate;
}

// ── Main ─────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();

    console.log("\n── Demo with synthetic data ──\n");
    runDemo();
    return;
  }

  const specPath = args[0];
  if (!fs.existsSync(specPath)) {
    console.error(`File not found: ${specPath}`);
    process.exit(1);
  }

  const spec: TransferSpec = JSON.parse(fs.readFileSync(specPath, "utf-8"));
  generatePsbtCommands(spec);
}

function runDemo() {
  const spec: TransferSpec = {
    vaultUtxos: [
      {
        txid: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        vout: 0,
        sats: 546,
        label: "Institution: Acme Financial",
      },
      {
        txid: "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",
        vout: 0,
        sats: 546,
        label: "Template: KYC Onboarding",
      },
      {
        txid: "c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4",
        vout: 0,
        sats: 546,
        label: "Template: Loan Approval",
      },
    ],
    feeUtxo: {
      txid: "d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5",
      vout: 1,
      sats: 50000,
    },
    newVaultAddress: "tb1p7p7fnwm58lvt7du6pv9duk7g7xgjldk2w0rmglu92exkja0d6aasphqrv7",
    changeAddress: "tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx",
    feeRate: 10,
    leaf: 0,
  };

  generatePsbtCommands(spec);
}

function generatePsbtCommands(spec: TransferSpec) {
  const { vaultUtxos, feeUtxo, newVaultAddress, changeAddress, feeRate, leaf } = spec;

  // Total inputs = vault UTXOs + fee UTXO
  const totalInputs = vaultUtxos.length + 1;
  // Outputs = one per vault UTXO (preserving inscription sats) + change
  const totalOutputs = vaultUtxos.length + 1;

  const fee = estimateFee(totalInputs, totalOutputs, feeRate);
  const totalVaultSats = vaultUtxos.reduce((sum, u) => sum + u.sats, 0);
  const changeSats = feeUtxo.sats - fee;

  if (changeSats < 546) {
    console.error(`ERROR: Fee UTXO (${feeUtxo.sats} sats) is too small for fee (${fee} sats).`);
    console.error(`Need at least ${fee + 546} sats in the fee UTXO.`);
    process.exit(1);
  }

  console.log("═══ BINST Atomic Institution Transfer (PSBT) ═══\n");
  console.log(`Spending path: Leaf ${leaf} (${leaf === 0 ? "admin + CSV" : "committee 2-of-3"})`);
  console.log(`Vault UTXOs:   ${vaultUtxos.length}`);
  console.log(`Fee UTXO:      ${feeUtxo.sats} sats`);
  console.log(`Estimated fee: ${fee} sats (~${estimateTxSize(totalInputs, totalOutputs)} vB × ${feeRate} sat/vB)`);
  console.log(`Change:        ${changeSats} sats`);
  console.log("");

  // ── Step 1: List inputs ────────────────────────────────────────
  console.log("── Inputs (all-or-nothing) ──");
  vaultUtxos.forEach((u, i) => {
    const seq = leaf === 0 ? 144 : 0;
    console.log(`  [${i}] ${u.label}`);
    console.log(`      txid: ${u.txid}  vout: ${u.vout}  sats: ${u.sats}  nSequence: ${seq}`);
  });
  console.log(`  [${vaultUtxos.length}] Fee input`);
  console.log(`      txid: ${feeUtxo.txid}  vout: ${feeUtxo.vout}  sats: ${feeUtxo.sats}`);
  console.log("");

  // ── Step 2: List outputs ───────────────────────────────────────
  console.log("── Outputs ──");
  vaultUtxos.forEach((u, i) => {
    console.log(`  [${i}] ${u.label} → new vault`);
    console.log(`      address: ${newVaultAddress}  sats: ${u.sats}`);
  });
  console.log(`  [${vaultUtxos.length}] Change`);
  console.log(`      address: ${changeAddress}  sats: ${changeSats}`);
  console.log("");

  // ── Step 3: bitcoin-cli createpsbt ─────────────────────────────
  const inputs = [
    ...vaultUtxos.map((u) => ({
      txid: u.txid,
      vout: u.vout,
      sequence: leaf === 0 ? 144 : 0,
    })),
    { txid: feeUtxo.txid, vout: feeUtxo.vout },
  ];

  const outputs: Record<string, number>[] = [];
  // Combine outputs to same address (bitcoin-cli needs unique keys per object)
  // Each inscription UTXO must go to a SEPARATE output to preserve sat isolation
  // bitcoin-cli createpsbt doesn't support duplicate keys, so we note this:
  const outputMap: Record<string, number> = {};
  vaultUtxos.forEach((u) => {
    // If multiple inscriptions go to the same vault address, they MUST be
    // separate outputs. bitcoin-cli createpsbt handles this via array of objects.
    outputs.push({ [newVaultAddress]: u.sats / 1e8 });
  });
  outputs.push({ [changeAddress]: changeSats / 1e8 });

  const inputsJson = JSON.stringify(inputs);
  const outputsJson = JSON.stringify(outputs);

  console.log("── bitcoin-cli commands ──\n");
  console.log("# Step 1: Create unsigned PSBT");
  console.log(`bitcoin-cli -testnet4 createpsbt '${inputsJson}' '${outputsJson}'\n`);

  console.log("# Step 2: Inspect the PSBT (verify before signing!)");
  console.log("bitcoin-cli -testnet4 decodepsbt <base64_psbt>\n");

  if (leaf === 0) {
    console.log("# Step 3a: Admin signs (Leaf 0 — single key, CSV delay)");
    console.log("#   Each vault input needs: <admin_signature> <leaf_0_script> <control_block>");
    console.log("#   Use walletprocesspsbt if the key is in Bitcoin Core's wallet:");
    console.log("bitcoin-cli -testnet4 walletprocesspsbt <base64_psbt>\n");

    console.log("# Step 4: Finalize and broadcast");
    console.log("bitcoin-cli -testnet4 finalizepsbt <signed_base64_psbt>");
    console.log("bitcoin-cli -testnet4 sendrawtransaction <hex_from_finalize>\n");

    console.log("─── CSV Note ───");
    console.log("All vault UTXOs must be ≥ 144 blocks old (nSequence = 144).");
    console.log("If any UTXO is younger, it CANNOT be spent via Leaf 0.");
    console.log("Split into multiple TXs: matured UTXOs now, young UTXOs later.");
  } else {
    console.log("# Step 3b: Committee signs (Leaf 1 — 2-of-3 OP_CHECKSIGADD)");
    console.log("#   Member A signs:");
    console.log("bitcoin-cli -testnet4 walletprocesspsbt <base64_psbt>  # → partially_signed");
    console.log("#   Member B signs:");
    console.log("bitcoin-cli -testnet4 walletprocesspsbt <partially_signed>  # → fully_signed");
    console.log("#   (Third member does NOT sign — empty sig in witness)\n");

    console.log("# Step 3c: Combine (if signed independently):");
    console.log('bitcoin-cli -testnet4 combinepsbt \'["<psbt_from_A>", "<psbt_from_B>"]\'\n');

    console.log("# Step 4: Finalize and broadcast");
    console.log("bitcoin-cli -testnet4 finalizepsbt <combined_psbt>");
    console.log("bitcoin-cli -testnet4 sendrawtransaction <hex_from_finalize>\n");

    console.log("─── Committee Note ───");
    console.log("Leaf 1 has NO CSV delay — committee spends are immediate.");
    console.log("Use for: admin key lost, key compromised, emergency recovery.");
    console.log("Witness per input: <sig_C_or_empty> <sig_B_or_empty> <sig_A> <script> <control_block>");
  }

  console.log("");
  console.log("─── Atomicity ───");
  console.log(`This transaction has ${totalInputs} inputs and ${totalOutputs} outputs.`);
  console.log("Bitcoin consensus makes it all-or-nothing: every inscription moves,");
  console.log("or none do. PSBT is just the workflow format for building and");
  console.log("co-signing the transaction before broadcast.");

  console.log("");
  console.log("─── After broadcast ───");
  console.log("1. Verify all inscription UTXOs arrived at new vault:");
  console.log("   ord --testnet4 wallet inscriptions");
  console.log("2. Update Citrea contracts:");
  console.log("   institution.transferAdmin(newAdminAddress)");
  console.log("3. Each new vault UTXO starts a fresh 144-block CSV timer.");
}

function printUsage() {
  console.log("BINST Atomic Institution Transfer — PSBT Generator\n");
  console.log("Usage:");
  console.log("  npx tsx scripts/psbt-transfer.ts [transfer_spec.json]\n");
  console.log("Without arguments: runs a demo with synthetic data.\n");
  console.log("Transfer spec JSON format:");
  console.log('  {');
  console.log('    "vaultUtxos": [');
  console.log('      { "txid": "...", "vout": 0, "sats": 546, "label": "Institution" }');
  console.log("    ],");
  console.log('    "feeUtxo": { "txid": "...", "vout": 1, "sats": 50000 },');
  console.log('    "newVaultAddress": "tb1p...",');
  console.log('    "changeAddress": "tb1q...",');
  console.log('    "feeRate": 10,');
  console.log('    "leaf": 0');
  console.log("  }");
}

main();
