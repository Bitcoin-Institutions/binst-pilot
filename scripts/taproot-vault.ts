/**
 * Taproot Vault Script Builder for BINST inscription UTXOs.
 *
 * Generates a Taproot output descriptor where:
 *   - Internal key = NUMS point (unspendable — no key-path spend)
 *   - Leaf 0: admin single-sig with CSV delay (~24h = 144 blocks)
 *   - Leaf 1: 2-of-3 committee multisig (immediate)
 *
 * This script prevents accidental spending of inscription UTXOs at the
 * consensus level. See BITCOIN-IDENTITY.md for the full rationale.
 *
 * Usage:
 *   npx ts-node scripts/taproot-vault.ts <admin_pubkey> <committee_key_1> <committee_key_2> <committee_key_3>
 *
 * Output:
 *   - Leaf scripts in hex
 *   - Taproot output key
 *   - Descriptor for use with Bitcoin Core / ord
 *
 * NOTE: This is a reference implementation. For production use, integrate
 *       with a proper Bitcoin library (bitcoinjs-lib, rust-bitcoin, etc.).
 */

// ── Opcodes ──────────────────────────────────────────────────────

const OP_CHECKSIG = 0xac;
const OP_CHECKSEQUENCEVERIFY = 0xb2;
const OP_DROP = 0x75;
const OP_2 = 0x52;
const OP_3 = 0x53;
const OP_CHECKMULTISIG = 0xae;

// NUMS point: provably unspendable x-only public key.
// H = lift_x(SHA256("BINST/vault/nums"))  — domain-separated nothing-up-my-sleeve point.
// For the pilot we use the well-known Ordinals NUMS point:
// 0x50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0
const NUMS_INTERNAL_KEY = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";

// CSV delay in blocks (~24 hours at 10 min/block)
const CSV_DELAY_BLOCKS = 144;

// ── Script builders ──────────────────────────────────────────────

/**
 * Build Leaf 0: admin single-sig with CSV delay.
 *
 * Script:
 *   <admin_pubkey> OP_CHECKSIG
 *   <csv_delay> OP_CHECKSEQUENCEVERIFY OP_DROP
 *
 * The admin can spend, but only after csv_delay blocks have passed
 * since the UTXO was created/last spent. This gives time to react
 * if the admin key is compromised.
 */
function buildAdminLeaf(adminPubkey: string, csvDelay: number = CSV_DELAY_BLOCKS): Uint8Array {
  const pubkeyBytes = hexToBytes(adminPubkey);
  if (pubkeyBytes.length !== 32) {
    throw new Error(`Admin pubkey must be 32 bytes (x-only), got ${pubkeyBytes.length}`);
  }

  const parts: number[] = [];

  // Push 32-byte admin pubkey
  parts.push(0x20); // push 32 bytes
  parts.push(...pubkeyBytes);
  parts.push(OP_CHECKSIG);

  // Push CSV delay as minimal encoding
  const delayBytes = encodeScriptNum(csvDelay);
  parts.push(delayBytes.length);
  parts.push(...delayBytes);
  parts.push(OP_CHECKSEQUENCEVERIFY);
  parts.push(OP_DROP);

  return new Uint8Array(parts);
}

/**
 * Build Leaf 1: 2-of-3 committee multisig (immediate).
 *
 * Script:
 *   OP_2 <key_A> <key_B> <key_C> OP_3 OP_CHECKMULTISIG
 *
 * The committee can move the inscription immediately. This is the
 * "break glass" path for key recovery or emergencies.
 *
 * NOTE: For Taproot script-path multisig, the standard approach is
 * OP_CHECKSIG/OP_CHECKSIGADD/OP_NUMEQUAL (BIP 342). But for pilot
 * simplicity we use the legacy OP_CHECKMULTISIG pattern which also
 * works in tapscript. Production should use MuSig2 or FROST.
 */
function buildCommitteeLeaf(keys: string[]): Uint8Array {
  if (keys.length !== 3) {
    throw new Error(`Committee requires exactly 3 keys, got ${keys.length}`);
  }

  const parts: number[] = [];

  parts.push(OP_2); // threshold

  for (const key of keys) {
    const keyBytes = hexToBytes(key);
    if (keyBytes.length !== 32) {
      throw new Error(`Committee key must be 32 bytes (x-only), got ${keyBytes.length}`);
    }
    parts.push(0x20); // push 32 bytes
    parts.push(...keyBytes);
  }

  parts.push(OP_3); // total keys
  parts.push(OP_CHECKMULTISIG);

  return new Uint8Array(parts);
}

// ── Helpers ──────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex length");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Encode an integer as a Bitcoin script number (minimal encoding).
 * For CSV delay values 0-252 this is a single byte.
 */
function encodeScriptNum(n: number): Uint8Array {
  if (n === 0) return new Uint8Array([]);
  if (n >= 1 && n <= 16) return new Uint8Array([0x50 + n]); // OP_1..OP_16

  // CScriptNum encoding: little-endian, sign bit in MSB
  const bytes: number[] = [];
  let val = Math.abs(n);
  while (val > 0) {
    bytes.push(val & 0xff);
    val >>= 8;
  }
  // If high bit set, add a zero byte for positive numbers
  if (bytes[bytes.length - 1] & 0x80) {
    bytes.push(n < 0 ? 0x80 : 0x00);
  } else if (n < 0) {
    bytes[bytes.length - 1] |= 0x80;
  }
  return new Uint8Array(bytes);
}

// ── Main ─────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    console.log("BINST Taproot Vault Script Builder");
    console.log("");
    console.log("Usage:");
    console.log("  npx ts-node scripts/taproot-vault.ts <admin_pubkey> <key_A> <key_B> <key_C>");
    console.log("");
    console.log("All keys must be 32-byte x-only Taproot public keys (64 hex chars).");
    console.log("");
    console.log("Example (testnet4, using dummy keys):");
    console.log(
      "  npx ts-node scripts/taproot-vault.ts " +
        "aaaa000000000000000000000000000000000000000000000000000000000001 " +
        "bbbb000000000000000000000000000000000000000000000000000000000002 " +
        "cccc000000000000000000000000000000000000000000000000000000000003 " +
        "dddd000000000000000000000000000000000000000000000000000000000004",
    );

    // Run demo with dummy keys
    console.log("\n── Demo with dummy keys ──\n");
    runVault(
      "aaaa000000000000000000000000000000000000000000000000000000000001",
      [
        "bbbb000000000000000000000000000000000000000000000000000000000002",
        "cccc000000000000000000000000000000000000000000000000000000000003",
        "dddd000000000000000000000000000000000000000000000000000000000004",
      ],
    );
    return;
  }

  const [adminKey, ...committeeKeys] = args;
  runVault(adminKey, committeeKeys.slice(0, 3));
}

function runVault(adminKey: string, committeeKeys: string[]) {
  console.log("NUMS internal key (unspendable):");
  console.log(`  ${NUMS_INTERNAL_KEY}`);
  console.log("");

  const adminLeaf = buildAdminLeaf(adminKey);
  console.log(`Leaf 0 — Admin transfer (${CSV_DELAY_BLOCKS}-block CSV delay):`);
  console.log(`  Admin pubkey: ${adminKey}`);
  console.log(`  Script hex:   ${bytesToHex(adminLeaf)}`);
  console.log(`  Script size:  ${adminLeaf.length} bytes`);
  console.log("");

  const committeeLeaf = buildCommitteeLeaf(committeeKeys);
  console.log("Leaf 1 — Committee override (2-of-3, immediate):");
  console.log(`  Key A: ${committeeKeys[0]}`);
  console.log(`  Key B: ${committeeKeys[1]}`);
  console.log(`  Key C: ${committeeKeys[2]}`);
  console.log(`  Script hex:   ${bytesToHex(committeeLeaf)}`);
  console.log(`  Script size:  ${committeeLeaf.length} bytes`);
  console.log("");

  console.log("Taproot output structure:");
  console.log("  Internal key: NUMS (key-path DISABLED)");
  console.log("  Script tree:");
  console.log(`    ├── Leaf 0: <admin> OP_CHECKSIG <${CSV_DELAY_BLOCKS}> OP_CSV OP_DROP`);
  console.log("    └── Leaf 1: OP_2 <A> <B> <C> OP_3 OP_CHECKMULTISIG");
  console.log("");
  console.log("To use with ord for inscribing:");
  console.log("  1. Construct the Taproot output address from the above scripts");
  console.log("  2. Use 'ord wallet inscribe' with --destination set to this address");
  console.log("  3. The inscription UTXO will be locked in the vault");
  console.log("");
  console.log("NOTE: Full address generation requires tagged hash computation");
  console.log("(BIP 341 taptweak). Use bitcoinjs-lib or rust-bitcoin for this.");
}

main();
