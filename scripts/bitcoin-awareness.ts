import { createPublicClient, http, parseAbi } from "viem";

/**
 * bitcoin-awareness.ts — Off-chain Bitcoin awareness tooling
 *
 * Replaces the BitcoinAnchor smart contract with direct calls to
 * Citrea's system contracts and RPCs. No contract deployment needed.
 *
 * This script demonstrates everything BitcoinAnchor.sol did, but
 * without paying gas or storing redundant data on-chain:
 *
 *   1. Read the latest Bitcoin block known to Citrea's Light Client
 *   2. Read any Bitcoin block hash by height
 *   3. Query the witness Merkle root for a block
 *   4. Query Citrea finality RPCs (committed / proven L2 heights)
 *   5. Find the sequencer commitment and ZK batch proof for a specific
 *      Bitcoin block (the data actually inscribed on Bitcoin)
 *
 * All of this uses eth_call (free, no gas) + Citrea custom RPCs.
 *
 * Usage:
 *   npx tsx scripts/bitcoin-awareness.ts
 */

const RPC = process.env.CITREA_TESTNET_RPC_URL || "https://rpc.testnet.citrea.xyz";

const LIGHT_CLIENT = "0x3100000000000000000000000000000000000001" as const;

const lightClientAbi = parseAbi([
  "function getBlockHash(uint256 blockNumber) external view returns (bytes32)",
  "function getWitnessRootByHash(bytes32 blockHash) external view returns (bytes32)",
  "function getWitnessRootByNumber(uint256 blockNumber) external view returns (bytes32)",
]);

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

const client = createPublicClient({ transport: http(RPC) });

// ── Helpers ──────────────────────────────────────────────────────

/** Convert little-endian hex hash to Bitcoin display format (big-endian) */
function hashToBitcoinFormat(hashLE: string): string {
  const raw = hashLE.startsWith("0x") ? hashLE.slice(2) : hashLE;
  return raw.match(/.{2}/g)!.reverse().join("");
}

/** Read a Bitcoin block hash from the Light Client (free eth_call) */
async function getBtcBlockHash(height: bigint): Promise<string> {
  return await client.readContract({
    address: LIGHT_CLIENT,
    abi: lightClientAbi,
    functionName: "getBlockHash",
    args: [height],
  });
}

/** Read the witness Merkle root for a Bitcoin block */
async function getBtcWitnessRoot(height: bigint): Promise<string> {
  return await client.readContract({
    address: LIGHT_CLIENT,
    abi: lightClientAbi,
    functionName: "getWitnessRootByNumber",
    args: [height],
  });
}

/** Binary search for the latest BTC block the Light Client knows about */
async function findLatestBtcBlock(): Promise<bigint> {
  let low = 100_000n;
  let high = 200_000n;
  // Expand upper bound until we hit an unknown block
  while (true) {
    const h = await getBtcBlockHash(high);
    if (h === ZERO_HASH) break;
    high *= 2n;
  }
  // Binary search
  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    const h = await getBtcBlockHash(mid);
    if (h !== ZERO_HASH) low = mid;
    else high = mid - 1n;
  }
  return low;
}

/** Citrea custom RPC call helper */
async function citreaRpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
  });
  const json = (await res.json()) as { result?: unknown; error?: unknown };
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Bitcoin Awareness — Off-chain tooling");
  console.log("  (replaces BitcoinAnchor.sol — no contract needed)");
  console.log("═══════════════════════════════════════════════════════\n");

  // 1. Latest BTC block in the Light Client
  console.log("━━━ 1. Latest Bitcoin Block (via Light Client) ━━━━━━━");
  const latestBtcBlock = await findLatestBtcBlock();
  const latestHash = await getBtcBlockHash(latestBtcBlock);
  const witnessRoot = await getBtcWitnessRoot(latestBtcBlock);
  console.log(`  Height:       ${latestBtcBlock}`);
  console.log(`  Hash (BTC):   ${hashToBitcoinFormat(latestHash)}`);
  console.log(`  Witness root: ${witnessRoot}`);
  console.log(`  Verify:       https://mempool.space/testnet4/block/${latestBtcBlock}`);
  console.log("");

  // 2. Sample historical blocks
  console.log("━━━ 2. Sample Historical Bitcoin Blocks ━━━━━━━━━━━━━");
  const samples = [1n, 100_000n, latestBtcBlock - 10n, latestBtcBlock];
  for (const h of samples) {
    if (h < 1n) continue;
    const hash = await getBtcBlockHash(h);
    const available = hash !== ZERO_HASH;
    console.log(`  BTC ${h}: ${available ? `✅ ${hashToBitcoinFormat(hash).slice(0, 16)}...` : "❌ not available"}`);
  }
  console.log("");

  // 3. Citrea finality RPCs
  console.log("━━━ 3. Citrea Finality Status ━━━━━━━━━━━━━━━━━━━━━━━");
  const committed = (await citreaRpc("citrea_getLastCommittedL2Height")) as any;
  const proven = (await citreaRpc("citrea_getLastProvenL2Height")) as any;
  const commitH = committed?.height ?? committed;
  const provenH = proven?.height ?? proven;
  console.log(`  Last COMMITTED L2 block: ${commitH}`);
  console.log(`  Last ZK-PROVEN L2 block: ${provenH}`);
  console.log("");

  // 4. Check a specific L2 block's finality (e.g. our deployed blocks)
  const watchL2 = BigInt(process.env.WATCH_L2 || "23972426");
  console.log(`━━━ 4. Finality Check for L2 Block ${watchL2} ━━━━━━━`);
  const isCommitted = Number(commitH) >= Number(watchL2);
  const isProven = Number(provenH) >= Number(watchL2);
  console.log(`  Committed on Bitcoin?  ${isCommitted ? "✅ YES" : `⏳ NO (${Number(watchL2) - Number(commitH)} blocks behind)`}`);
  console.log(`  ZK-proven on Bitcoin?  ${isProven ? "✅ YES" : `⏳ NO (${Number(watchL2) - Number(provenH)} blocks behind)`}`);
  console.log("");

  // 5. Find the sequencer commitment that covers the committed height
  console.log("━━━ 5. Sequencer Commitments on Recent BTC Blocks ━━━");
  for (let btcH = Number(latestBtcBlock); btcH > Number(latestBtcBlock) - 10; btcH--) {
    try {
      const result = (await citreaRpc("ledger_getSequencerCommitmentsOnSlotByNumber", [btcH])) as any;
      if (result && result.length > 0) {
        for (const c of result) {
          const endL2 = parseInt(c.l2EndBlockNumber, 16);
          console.log(`  BTC ${btcH}: commitment → L2 end block ${endL2} (index ${parseInt(c.index, 16)})`);
        }
      }
    } catch {
      // RPC might not support this or block has no commitment
    }
  }
  console.log("");

  // 6. Find batch proofs on recent BTC blocks
  console.log("━━━ 6. ZK Batch Proofs on Recent BTC Blocks ━━━━━━━━━");
  for (let btcH = Number(latestBtcBlock); btcH > Number(latestBtcBlock) - 10; btcH--) {
    try {
      const result = (await citreaRpc("ledger_getVerifiedBatchProofsBySlotHeight", [btcH])) as any;
      if (result && result.length > 0) {
        console.log(`  BTC ${btcH}: ✅ ZK batch proof found (${result.length} proof(s))`);
      }
    } catch {
      // skip
    }
  }

  console.log("");
  console.log("═══════════════════════════════════════════════════════");
  console.log("  All data above was read without any custom contract.");
  console.log("  Light Client: eth_call to 0x3100...0001 (free)");
  console.log("  Finality:     Citrea RPCs (free)");
  console.log("═══════════════════════════════════════════════════════");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
