/**
 * @deprecated This hand-rolled Taproot construction is superseded by the
 * Rust miniscript vault module (`binst-decoder/src/vault.rs`).
 *
 * The new implementation uses BIP 379 miniscript policy descriptors compiled
 * via `rust-miniscript`, producing wallet-compatible output. This file is
 * kept as a reference for the original key/address values used during
 * development. See MINISCRIPT.md for architecture details.
 *
 * TODO: Remove once the webapp vault flow is fully operational (Phase 4).
 */

/**
 * Taproot Vault — BINST inscription UTXO safety.
 *
 * Builds a complete Taproot output (BIP 341/342) that locks inscription
 * UTXOs against accidental spending:
 *
 *   Internal key = NUMS point (unspendable — key-path disabled)
 *   Leaf 0: admin single-sig + 144-block CSV delay (~24 hours)
 *   Leaf 1: 2-of-3 committee multisig (immediate — emergency path)
 *
 * Produces:
 *   - Leaf scripts (hex)
 *   - Taptree merkle root
 *   - Tweaked output key (BIP 341 taptweak)
 *   - Bech32m address (tb1p... testnet4, bc1p... mainnet)
 *   - Control blocks for spending each leaf
 *
 * Usage:
 *   npx tsx scripts/taproot-vault.ts <admin_pubkey> <key_A> <key_B> <key_C> [--mainnet]
 *
 * Dependencies: @noble/curves, @noble/hashes, @scure/base (all from viem)
 */

import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bech32m } from "@scure/base";

// ── Constants ────────────────────────────────────────────────────

// BIP 342 opcodes (Tapscript)
const OP_CHECKSIG = 0xac;
const OP_CHECKSIGADD = 0xba;
const OP_NUMEQUAL = 0x9c;
const OP_CHECKSEQUENCEVERIFY = 0xb2;
const OP_DROP = 0x75;
const OP_2 = 0x52;

// Tapscript leaf version (BIP 342: 0xc0)
const LEAF_VERSION = 0xc0;

// NUMS point: provably unspendable x-only public key.
// The well-known Ordinals NUMS point (no known discrete log):
const NUMS_INTERNAL_KEY = "50929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0";

// CSV delay in blocks (~24 hours at 10 min/block)
const CSV_DELAY_BLOCKS = 144;

// secp256k1 field order
const SECP256K1_ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

// ── Hex helpers ──────────────────────────────────────────────────

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

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    result.set(a, offset);
    offset += a.length;
  }
  return result;
}

// ── Bitcoin script number encoding ───────────────────────────────

function encodeScriptNum(n: number): Uint8Array {
  if (n === 0) return new Uint8Array([]);

  // CScriptNum: little-endian, sign bit in MSB of last byte
  const bytes: number[] = [];
  let val = Math.abs(n);
  while (val > 0) {
    bytes.push(val & 0xff);
    val >>= 8;
  }
  if (bytes[bytes.length - 1] & 0x80) {
    bytes.push(n < 0 ? 0x80 : 0x00);
  } else if (n < 0) {
    bytes[bytes.length - 1] |= 0x80;
  }
  return new Uint8Array(bytes);
}

// ── BIP 340/341 tagged hashes ────────────────────────────────────

function taggedHash(tag: string, ...data: Uint8Array[]): Uint8Array {
  const tagHash = sha256(new TextEncoder().encode(tag));
  return sha256(concatBytes(tagHash, tagHash, ...data));
}

// ── Leaf script builders ─────────────────────────────────────────

/**
 * Leaf 0: admin single-sig with CSV delay.
 *
 * Script (BIP 342):
 *   <admin_pubkey> OP_CHECKSIG
 *   <csv_delay> OP_CHECKSEQUENCEVERIFY OP_DROP
 */
function buildAdminLeaf(adminPubkey: string, csvDelay: number = CSV_DELAY_BLOCKS): Uint8Array {
  const pubkeyBytes = hexToBytes(adminPubkey);
  if (pubkeyBytes.length !== 32) {
    throw new Error(`Admin pubkey must be 32 bytes (x-only), got ${pubkeyBytes.length}`);
  }

  const delayBytes = encodeScriptNum(csvDelay);
  const parts: number[] = [];

  // <admin_pubkey> OP_CHECKSIG
  parts.push(0x20); // push 32 bytes
  parts.push(...pubkeyBytes);
  parts.push(OP_CHECKSIG);

  // <csv_delay> OP_CHECKSEQUENCEVERIFY OP_DROP
  parts.push(delayBytes.length); // push N bytes
  parts.push(...delayBytes);
  parts.push(OP_CHECKSEQUENCEVERIFY);
  parts.push(OP_DROP);

  return new Uint8Array(parts);
}

/**
 * Leaf 1: 2-of-3 committee multisig (immediate).
 *
 * Script (BIP 342 — OP_CHECKSIGADD pattern):
 *   <key_A> OP_CHECKSIG
 *   <key_B> OP_CHECKSIGADD
 *   <key_C> OP_CHECKSIGADD
 *   <2> OP_NUMEQUAL
 *
 * This is the BIP 342 way to do k-of-n in Tapscript.
 * OP_CHECKMULTISIG is disabled in Tapscript.
 */
function buildCommitteeLeaf(keys: string[]): Uint8Array {
  if (keys.length !== 3) {
    throw new Error(`Committee requires exactly 3 keys, got ${keys.length}`);
  }

  for (const key of keys) {
    if (hexToBytes(key).length !== 32) {
      throw new Error("Committee key must be 32 bytes (x-only)");
    }
  }

  const parts: number[] = [];

  // <key_A> OP_CHECKSIG
  parts.push(0x20);
  parts.push(...hexToBytes(keys[0]));
  parts.push(OP_CHECKSIG);

  // <key_B> OP_CHECKSIGADD
  parts.push(0x20);
  parts.push(...hexToBytes(keys[1]));
  parts.push(OP_CHECKSIGADD);

  // <key_C> OP_CHECKSIGADD
  parts.push(0x20);
  parts.push(...hexToBytes(keys[2]));
  parts.push(OP_CHECKSIGADD);

  // <2> OP_NUMEQUAL
  parts.push(OP_2);
  parts.push(OP_NUMEQUAL);

  return new Uint8Array(parts);
}

// ── BIP 341 Taptree ──────────────────────────────────────────────

/**
 * Compute the tagged leaf hash for a Tapscript leaf.
 * TapLeaf = TaggedHash("TapLeaf", leaf_version || compact_size(script) || script)
 */
function tapLeafHash(script: Uint8Array): Uint8Array {
  const size = compactSize(script.length);
  return taggedHash("TapLeaf", new Uint8Array([LEAF_VERSION]), size, script);
}

/**
 * Compute the tagged branch hash for two children.
 * TapBranch = TaggedHash("TapBranch", sorted(left, right))
 */
function tapBranchHash(left: Uint8Array, right: Uint8Array): Uint8Array {
  const cmp = compareBytes(left, right);
  if (cmp <= 0) {
    return taggedHash("TapBranch", left, right);
  } else {
    return taggedHash("TapBranch", right, left);
  }
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

function compactSize(n: number): Uint8Array {
  if (n < 253) return new Uint8Array([n]);
  if (n < 0x10000) {
    const buf = new Uint8Array(3);
    buf[0] = 253;
    buf[1] = n & 0xff;
    buf[2] = (n >> 8) & 0xff;
    return buf;
  }
  throw new Error(`compactSize too large: ${n}`);
}

// ── BIP 341 Taptweak ─────────────────────────────────────────────

/**
 * Compute the tweaked output key: Q = P + t*G
 * where t = TaggedHash("TapTweak", P || merkle_root)
 *
 * Returns { outputKey, parity, tweak }
 */
function computeTaptweak(
  internalKey: string,
  merkleRoot: Uint8Array,
): { outputKey: Uint8Array; parity: number; tweak: Uint8Array } {
  const P = hexToBytes(internalKey);
  const tweak = taggedHash("TapTweak", P, merkleRoot);

  const t = BigInt("0x" + bytesToHex(tweak));
  if (t >= SECP256K1_ORDER) {
    throw new Error("Tweak is >= curve order (astronomically unlikely)");
  }

  // Lift x-only P to a full point (assume even Y, per BIP 341)
  const compressedP = new Uint8Array(33);
  compressedP[0] = 0x02;
  compressedP.set(P, 1);
  const pointP = secp256k1.ProjectivePoint.fromHex(compressedP);
  const pointT = secp256k1.ProjectivePoint.BASE.multiply(t);
  const pointQ = pointP.add(pointT);

  // x-only output key (even Y)
  const qBytes = pointQ.toRawBytes(true); // 33 bytes compressed
  const parity = (qBytes[0] === 0x02) ? 0 : 1;
  const outputKey = qBytes.slice(1); // x-only (32 bytes)

  return { outputKey, parity, tweak };
}

// ── Bech32m address ──────────────────────────────────────────────

function encodeTaprootAddress(outputKey: Uint8Array, hrp: string = "tb"): string {
  const words = bech32m.toWords(outputKey);
  return bech32m.encode(hrp, [1, ...words]);
}

// ── Control blocks ───────────────────────────────────────────────

/**
 * Build the control block for spending a specific leaf in a 2-leaf tree.
 *
 * Control block = (parity | leaf_version) || internal_key || sibling_hash
 */
function buildControlBlock(
  internalKey: string,
  parity: number,
  siblingHash: Uint8Array,
): Uint8Array {
  const firstByte = LEAF_VERSION | parity;
  return concatBytes(
    new Uint8Array([firstByte]),
    hexToBytes(internalKey),
    siblingHash,
  );
}

// ── Main ─────────────────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const isMainnet = args.includes("--mainnet");
  const keys = args.filter((a) => !a.startsWith("--"));

  if (keys.length < 4) {
    console.log("BINST Taproot Vault Script Builder\n");
    console.log("Usage:");
    console.log("  npx tsx scripts/taproot-vault.ts <admin_pubkey> <key_A> <key_B> <key_C> [--mainnet]\n");
    console.log("All keys must be 32-byte x-only public keys (64 hex chars).\n");

    // Demo with real secp256k1 points
    console.log("── Demo with derived keys ──\n");
    const G  = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    const K2 = "c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
    const K3 = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
    const K4 = "e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13";
    runVault(G, [K2, K3, K4], false);
    return;
  }

  const [adminKey, ...committeeKeys] = keys;
  runVault(adminKey, committeeKeys.slice(0, 3), isMainnet);
}

function runVault(adminKey: string, committeeKeys: string[], mainnet: boolean) {
  const hrp = mainnet ? "bc" : "tb";

  // ── Build leaf scripts ──

  const adminScript = buildAdminLeaf(adminKey);
  const committeeScript = buildCommitteeLeaf(committeeKeys);

  console.log("NUMS internal key (unspendable):");
  console.log(`  ${NUMS_INTERNAL_KEY}\n`);

  console.log(`Leaf 0 — Admin + ${CSV_DELAY_BLOCKS}-block CSV:`);
  console.log(`  Script hex:  ${bytesToHex(adminScript)}`);
  console.log(`  Script size: ${adminScript.length} bytes\n`);

  console.log("Leaf 1 — 2-of-3 committee (OP_CHECKSIGADD):");
  console.log(`  Script hex:  ${bytesToHex(committeeScript)}`);
  console.log(`  Script size: ${committeeScript.length} bytes\n`);

  // ── Compute taptree merkle root ──

  const leafHash0 = tapLeafHash(adminScript);
  const leafHash1 = tapLeafHash(committeeScript);
  const merkleRoot = tapBranchHash(leafHash0, leafHash1);

  console.log("Taptree:");
  console.log(`  Leaf 0 hash:  ${bytesToHex(leafHash0)}`);
  console.log(`  Leaf 1 hash:  ${bytesToHex(leafHash1)}`);
  console.log(`  Merkle root:  ${bytesToHex(merkleRoot)}\n`);

  // ── Compute tweaked output key ──

  const { outputKey, parity, tweak } = computeTaptweak(NUMS_INTERNAL_KEY, merkleRoot);

  console.log("BIP 341 taptweak:");
  console.log(`  Tweak:         ${bytesToHex(tweak)}`);
  console.log(`  Output key:    ${bytesToHex(outputKey)}`);
  console.log(`  Output parity: ${parity}\n`);

  // ── Bech32m address ──

  const address = encodeTaprootAddress(outputKey, hrp);
  console.log(`Taproot address (${mainnet ? "mainnet" : "testnet4"}):`);
  console.log(`  ${address}\n`);

  // ── Control blocks ──

  const cb0 = buildControlBlock(NUMS_INTERNAL_KEY, parity, leafHash1);
  const cb1 = buildControlBlock(NUMS_INTERNAL_KEY, parity, leafHash0);

  console.log("Control blocks (for spending):");
  console.log(`  Leaf 0 (admin):     ${bytesToHex(cb0)}`);
  console.log(`  Leaf 1 (committee): ${bytesToHex(cb1)}\n`);

  // ── Witness structure ──

  console.log("Witness for Leaf 0 spend (admin + CSV):");
  console.log("  <admin_signature>");
  console.log(`  <script: ${bytesToHex(adminScript)}>`);
  console.log(`  <control_block: ${bytesToHex(cb0)}>\n`);

  console.log("Witness for Leaf 1 spend (committee 2-of-3):");
  console.log("  <sig_C_or_empty> <sig_B_or_empty> <sig_A>");
  console.log(`  <script: ${bytesToHex(committeeScript)}>`);
  console.log(`  <control_block: ${bytesToHex(cb1)}>\n`);

  // ── Usage ──

  console.log("To inscribe into this vault:");
  console.log(`  ord wallet inscribe --destination ${address} --file <data>\n`);

  console.log("The inscription UTXO is locked. Only Leaf 0 (admin+CSV) or");
  console.log("Leaf 1 (committee) script-path spends can move it.");
}

main();
