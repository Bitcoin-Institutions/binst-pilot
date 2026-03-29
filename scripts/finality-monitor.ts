/**
 * finality-monitor.ts — Off-chain finality tracker for BINST
 *
 * Polls Citrea RPCs to detect when specific L2 blocks reach
 * committed / proven finality on Bitcoin. No smart contract needed.
 *
 * Outputs JSON status to stdout when each milestone is reached.
 * A future webapp can run this as a background service or cron job
 * and store results in a database.
 *
 * Usage:
 *   WATCH_L2=23972426 npx tsx scripts/finality-monitor.ts
 *   # or with custom interval (seconds):
 *   WATCH_L2=23972426 POLL_INTERVAL=60 npx tsx scripts/finality-monitor.ts
 */

const RPC = process.env.CITREA_TESTNET_RPC_URL || "https://rpc.testnet.citrea.xyz";
const WATCH_L2 = BigInt(process.env.WATCH_L2 || "23972426");
const POLL_INTERVAL = Number(process.env.POLL_INTERVAL || "30") * 1000; // ms

interface FinalityStatus {
  watchedL2Block: string;
  committed: boolean;
  proven: boolean;
  lastCommittedL2: string | null;
  lastProvenL2: string | null;
  timestamp: string;
}

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

function extractHeight(raw: unknown): bigint {
  if (typeof raw === "number" || typeof raw === "bigint") return BigInt(raw);
  if (typeof raw === "string") return BigInt(raw);
  if (raw && typeof raw === "object" && "height" in raw) {
    const h = (raw as { height: unknown }).height;
    if (typeof h === "number" || typeof h === "bigint") return BigInt(h);
    if (typeof h === "string") return BigInt(h);
  }
  throw new Error(`Cannot parse height from: ${JSON.stringify(raw)}`);
}

async function checkFinality(): Promise<FinalityStatus> {
  const [committedRaw, provenRaw] = await Promise.all([
    citreaRpc("citrea_getLastCommittedL2Height"),
    citreaRpc("citrea_getLastProvenL2Height"),
  ]);

  const committedH = extractHeight(committedRaw);
  const provenH = extractHeight(provenRaw);

  return {
    watchedL2Block: WATCH_L2.toString(),
    committed: committedH >= WATCH_L2,
    proven: provenH >= WATCH_L2,
    lastCommittedL2: committedH.toString(),
    lastProvenL2: provenH.toString(),
    timestamp: new Date().toISOString(),
  };
}

async function main() {
  console.log(`Finality monitor started`);
  console.log(`  Watching L2 block: ${WATCH_L2}`);
  console.log(`  Poll interval:     ${POLL_INTERVAL / 1000}s`);
  console.log(`  RPC:               ${RPC}`);
  console.log("");

  let wasCommitted = false;
  let wasProven = false;

  while (true) {
    try {
      const status = await checkFinality();

      // Report milestones
      if (status.committed && !wasCommitted) {
        wasCommitted = true;
        console.log(`\n🔒 COMMITTED — L2 block ${WATCH_L2} ordering is inscribed on Bitcoin`);
        console.log(`   Last committed L2: ${status.lastCommittedL2}`);
        console.log(`   ${status.timestamp}`);
        console.log(JSON.stringify({ event: "committed", ...status }, null, 2));
      }

      if (status.proven && !wasProven) {
        wasProven = true;
        console.log(`\n🛡️  ZK-PROVEN — L2 block ${WATCH_L2} is ZK-proven on Bitcoin`);
        console.log(`   Last proven L2: ${status.lastProvenL2}`);
        console.log(`   ${status.timestamp}`);
        console.log(JSON.stringify({ event: "proven", ...status }, null, 2));
      }

      if (wasProven) {
        console.log("\n✅ Fully proven. Monitor exiting.");
        break;
      }

      // Progress log
      const commitGap = status.committed ? 0 : Number(WATCH_L2) - Number(status.lastCommittedL2 ?? 0);
      const provenGap = status.proven ? 0 : Number(WATCH_L2) - Number(status.lastProvenL2 ?? 0);
      process.stdout.write(
        `  ${status.timestamp} | committed: ${status.committed ? "✅" : `⏳ -${commitGap}`} | proven: ${status.proven ? "✅" : `⏳ -${provenGap}`}\r`,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  Error: ${msg.slice(0, 120)}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
