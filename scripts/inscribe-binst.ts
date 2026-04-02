/**
 * BINST Inscription Script — inscribe a BINST entity on Bitcoin testnet4.
 *
 * This script generates the `ord` CLI commands to inscribe BINST entities
 * (institutions, templates, instances) on Bitcoin testnet4 using the
 * `binst` metaprotocol.
 *
 * Prerequisites:
 *   - `ord` CLI installed (https://github.com/ordinals/ord)
 *   - Bitcoin Core testnet4 node running and synced
 *   - `ord` wallet created: `ord --testnet4 wallet create`
 *   - Wallet funded with testnet4 BTC (faucet: https://faucet.testnet4.dev)
 *
 * Usage:
 *   npx ts-node scripts/inscribe-binst.ts institution <name> <admin_pubkey> [citrea_contract] [--destination <vault_address>]
 *   npx ts-node scripts/inscribe-binst.ts template <name> <parent_inscription_id> <steps_json> [citrea_contract] [--destination <vault_address>]
 *   npx ts-node scripts/inscribe-binst.ts instance <creator_pubkey> <parent_inscription_id> [citrea_contract] [--destination <vault_address>]
 *
 * This outputs the ord command and creates a temporary JSON file for the body.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ── Entity body builders ─────────────────────────────────────────

interface InstitutionBody {
  v: 0;
  type: "institution";
  name: string;
  admin: string;
  citrea_contract?: string;
  description?: string;
}

interface ProcessTemplateBody {
  v: 0;
  type: "process_template";
  name: string;
  steps: Array<{ name: string; action_type?: string }>;
  citrea_contract?: string;
  description?: string;
}

interface ProcessInstanceBody {
  v: 0;
  type: "process_instance";
  creator: string;
  citrea_contract?: string;
}

function buildInstitution(name: string, adminPubkey: string, citreaContract?: string): InstitutionBody {
  if (adminPubkey.length !== 64) {
    throw new Error("Admin pubkey must be 64 hex chars (32 bytes x-only)");
  }
  return {
    v: 0,
    type: "institution",
    name,
    admin: adminPubkey,
    ...(citreaContract ? { citrea_contract: citreaContract } : {}),
  };
}

function buildProcessTemplate(
  name: string,
  steps: Array<{ name: string; action_type?: string }>,
  citreaContract?: string,
): ProcessTemplateBody {
  if (steps.length === 0) throw new Error("Template must have at least one step");
  return {
    v: 0,
    type: "process_template",
    name,
    steps,
    ...(citreaContract ? { citrea_contract: citreaContract } : {}),
  };
}

function buildProcessInstance(creatorPubkey: string, citreaContract?: string): ProcessInstanceBody {
  if (creatorPubkey.length !== 64) {
    throw new Error("Creator pubkey must be 64 hex chars (32 bytes x-only)");
  }
  return {
    v: 0,
    type: "process_instance",
    creator: creatorPubkey,
    ...(citreaContract ? { citrea_contract: citreaContract } : {}),
  };
}

// ── ord command generator ────────────────────────────────────────

function generateOrdCommand(
  body: InstitutionBody | ProcessTemplateBody | ProcessInstanceBody,
  parentInscriptionId?: string,
  destination?: string,
): { bodyFile: string; command: string } {
  // Write body to temp file
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "binst-"));
  const bodyFile = path.join(tmpDir, `binst-${body.type}.json`);
  fs.writeFileSync(bodyFile, JSON.stringify(body, null, 2));

  // Build ord command
  // Note: ord infers content-type from file extension (.json → application/json)
  const parts = [
    "ord",
    "--testnet4",
    "--bitcoin-rpc-username=testnet4rpc",
    "--bitcoin-rpc-password=AgsJ324J_qqNWgy0Zb7TxemDGLKFdSje",
    "--bitcoin-rpc-url=http://127.0.0.1:48332",
    "wallet",
    "--no-sync",
    "--server-url", "http://localhost:8080",
    "inscribe",
    "--fee-rate", "10",                              // sat/vB
    "--postage", "546sat",                           // dust-limit UTXO (sat isolation)
    "--metaprotocol", "binst",                       // tag 7
    "--no-backup",                                   // skip recovery key backup
    "--file", bodyFile,                               // body content (content-type auto-detected)
  ];

  if (parentInscriptionId) {
    parts.push("--parent", parentInscriptionId);     // tag 3
  }

  if (destination) {
    parts.push("--destination", destination);         // send to vault address
  }

  return {
    bodyFile,
    command: parts.join(" \\\n  "),
  };
}

// ── Flag parsing ─────────────────────────────────────────────────

function extractFlag(args: string[], flag: string): { value: string | undefined; rest: string[] } {
  const idx = args.indexOf(flag);
  if (idx === -1) return { value: undefined, rest: args };
  const value = args[idx + 1];
  const rest = [...args.slice(0, idx), ...args.slice(idx + 2)];
  return { value, rest };
}

// ── Main ─────────────────────────────────────────────────────────

function main() {
  const rawArgs = process.argv.slice(2);
  const { value: destination, rest: args } = extractFlag(rawArgs, "--destination");
  const [entityType, ...rest] = args;

  if (!entityType) {
    printUsage();
    return;
  }

  switch (entityType) {
    case "institution": {
      const [name, adminPubkey, citreaContract] = rest;
      if (!name || !adminPubkey) {
        console.error("Usage: inscribe-binst.ts institution <name> <admin_pubkey> [citrea_contract] [--destination <vault_addr>]");
        process.exit(1);
      }
      const body = buildInstitution(name, adminPubkey, citreaContract);
      const { bodyFile, command } = generateOrdCommand(body, undefined, destination);

      console.log("═══ BINST Institution Inscription ═══\n");
      console.log("Body JSON:");
      console.log(JSON.stringify(body, null, 2));
      console.log(`\nBody file: ${bodyFile}`);
      console.log("\nord command:\n");
      console.log(command);
      console.log("\n─── Notes ───");
      console.log("• This is a ROOT inscription (no parent). The returned inscription ID");
      console.log("  becomes the parent for all process templates under this institution.");
      console.log("• After inscribing, call setInscriptionId() on the Citrea contract");
      console.log("  with the returned inscription ID.");
      if (destination) {
        console.log(`• Inscription UTXO: 546 sats → vault ${destination}`);
        console.log("  The inscribed sat is isolated on a dust-limit UTXO (sat isolation).");
        console.log("  Admin can unlock via Leaf 0 (CSV delay) after ~144 blocks.");
        console.log("  Committee can unlock via Leaf 1 (2-of-3 OP_CHECKSIGADD) immediately.");
      } else {
        console.log("⚠  WARNING: No --destination specified. The inscription will go to");
        console.log("  the ord wallet's default address (NOT a vault). Use --destination");
        console.log("  <vault_address> to lock the inscription. Generate a vault address");
        console.log("  with: npx tsx scripts/taproot-vault.ts <admin_pubkey> <keyA> <keyB> <keyC>");
      }
      break;
    }

    case "template": {
      const [name, parentId, stepsJson, citreaContract] = rest;
      if (!name || !parentId || !stepsJson) {
        console.error(
          'Usage: inscribe-binst.ts template <name> <parent_inscription_id> \'[{"name":"Step1","action_type":"approval"}]\' [citrea_contract]',
        );
        process.exit(1);
      }
      const steps = JSON.parse(stepsJson);
      const body = buildProcessTemplate(name, steps, citreaContract);
      const { bodyFile, command } = generateOrdCommand(body, parentId, destination);

      console.log("═══ BINST Process Template Inscription ═══\n");
      console.log("Body JSON:");
      console.log(JSON.stringify(body, null, 2));
      console.log(`\nBody file: ${bodyFile}`);
      console.log(`Parent inscription: ${parentId}`);
      console.log("\nord command:\n");
      console.log(command);
      console.log("\n─── Notes ───");
      console.log("• Parent must be an institution inscription owned by this wallet.");
      console.log("• The returned inscription ID becomes the parent for instances.");
      break;
    }

    case "instance": {
      const [creatorPubkey, parentId, citreaContract] = rest;
      if (!creatorPubkey || !parentId) {
        console.error("Usage: inscribe-binst.ts instance <creator_pubkey> <parent_inscription_id> [citrea_contract]");
        process.exit(1);
      }
      const body = buildProcessInstance(creatorPubkey, citreaContract);
      const { bodyFile, command } = generateOrdCommand(body, parentId, destination);

      console.log("═══ BINST Process Instance Inscription ═══\n");
      console.log("Body JSON:");
      console.log(JSON.stringify(body, null, 2));
      console.log(`\nBody file: ${bodyFile}`);
      console.log(`Parent inscription: ${parentId}`);
      console.log("\nord command:\n");
      console.log(command);
      break;
    }

    default:
      console.error(`Unknown entity type: ${entityType}`);
      printUsage();
      process.exit(1);
  }
}

function printUsage() {
  console.log("BINST Inscription Script — inscribe entities on Bitcoin testnet4\n");
  console.log("Usage:");
  console.log("  npx ts-node scripts/inscribe-binst.ts institution <name> <admin_pubkey> [citrea_contract]");
  console.log(
    '  npx ts-node scripts/inscribe-binst.ts template <name> <parent_id> \'[{"name":"Step1"}]\' [citrea_contract]',
  );
  console.log("  npx ts-node scripts/inscribe-binst.ts instance <creator_pubkey> <parent_id> [citrea_contract]");
  console.log("\nPrerequisites:");
  console.log("  - ord CLI installed: https://github.com/ordinals/ord");
  console.log("  - Bitcoin Core testnet4 running and synced");
  console.log("  - ord wallet created: ord --testnet4 wallet create");
  console.log("  - Wallet funded with testnet4 BTC");
  console.log("\nExample:");
  console.log(
    "  npx ts-node scripts/inscribe-binst.ts institution 'Acme Financial' " +
      "a3f4b2c1d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",
  );
}

main();
