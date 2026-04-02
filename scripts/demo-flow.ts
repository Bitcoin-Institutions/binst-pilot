import hre from "hardhat";
import { parseAbi } from "viem";

/**
 * demo-flow.ts — End-to-end BINST pilot demonstration
 *
 * This script demonstrates the full BINST lifecycle:
 * 1. Deploys BINSTDeployer (protocol entry-point)
 * 2. Creates an Institution (the "I" in BINST)
 * 3. Binds Bitcoin identity (btcPubkey, inscriptionId, runeId, vault address)
 * 4. Adds members to the institution
 * 5. Creates a "KYC Verification" process template through the institution
 * 6. Instantiates and executes the process step by step
 * 7. Queries Citrea's Bitcoin Light Client directly (no wrapper contract)
 * 8. Queries Citrea's finality RPCs to show Bitcoin anchoring status
 *
 * Architecture:
 *   Smart contracts → protocol-critical state + webapp visibility
 *   Bitcoin awareness → off-chain (Light Client reads + Citrea RPCs)
 *
 * Usage:
 *   npx hardhat run scripts/demo-flow.ts                          # local
 *   npx hardhat run scripts/demo-flow.ts --network citreaTestnet  # testnet
 */

const LIGHT_CLIENT = "0x3100000000000000000000000000000000000001" as const;

const lightClientAbi = parseAbi([
  "function getBlockHash(uint256 blockNumber) external view returns (bytes32)",
  "function getWitnessRootByNumber(uint256 blockNumber) external view returns (bytes32)",
]);

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();
  const [deployer] = await connection.viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  console.log("═══════════════════════════════════════════════════════");
  console.log("  BINST Pilot — Full Institutional Demo Flow");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Chain ID:    ${chainId}`);
  console.log(`  Deployer:    ${deployer.account.address}`);
  console.log("");

  // ── Step 1: Deploy protocol entry-point ────────────────────────
  console.log("▸ Deploying BINSTDeployer...");
  const binstDeployer = await connection.viem.deployContract("BINSTDeployer");
  console.log(`  ✓ BINSTDeployer at ${binstDeployer.address}`);
  console.log("");

  // ── Step 2: Create an Institution ──────────────────────────────
  console.log("▸ Creating institution 'Acme Financial Services'...");
  const instTx = await binstDeployer.write.createInstitution(["Acme Financial Services"]);
  const instReceipt = await publicClient.waitForTransactionReceipt({ hash: instTx });
  console.log(`  ✓ Institution created (gas: ${instReceipt.gasUsed})`);

  const institutions = await binstDeployer.read.getInstitutions();
  const institutionAddr = institutions[0];
  const institution = await connection.viem.getContractAt("Institution", institutionAddr);
  console.log(`  ✓ Institution at ${institutionAddr}`);
  console.log(`    Name:  ${await institution.read.name()}`);
  console.log(`    Admin: ${await institution.read.admin()}`);
  console.log("");

  // ── Step 3: Bind Bitcoin identity ──────────────────────────────
  // In production these values come from real Bitcoin operations:
  //   btcPubkey    → admin's x-only Taproot key (from wallet)
  //   inscriptionId → returned by `ord wallet inscribe`
  //   runeId        → returned by `ord wallet etch`
  // Here we use realistic demo values.

  const demoBtcPubkey = "0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798" as `0x${string}`;
  const demoInscriptionId = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2i0";
  const demoRuneId = "128195:42";

  console.log("▸ Binding Bitcoin identity to institution...");

  const pubkeyTx = await institution.write.setBtcPubkey([demoBtcPubkey]);
  await publicClient.waitForTransactionReceipt({ hash: pubkeyTx });
  console.log(`  ✓ btcPubkey set: ${demoBtcPubkey}`);

  const inscTx = await institution.write.setInscriptionId([demoInscriptionId]);
  await publicClient.waitForTransactionReceipt({ hash: inscTx });
  console.log(`  ✓ inscriptionId set: ${demoInscriptionId}`);

  const runeTx = await institution.write.setRuneId([demoRuneId]);
  await publicClient.waitForTransactionReceipt({ hash: runeTx });
  console.log(`  ✓ runeId set: ${demoRuneId}`);

  // Show the vault address this institution would use
  const vaultAddress = "tb1p7p7fnwm58lvt7du6pv9duk7g7xgjldk2w0rmglu92exkja0d6aasphqrv7";
  console.log(`  ✓ Taproot vault: ${vaultAddress}`);
  console.log("    (inscription UTXO locked by NUMS + admin CSV + committee multisig)");
  console.log("");

  // ── Step 4: Add members to the institution ─────────────────────
  console.log("▸ Adding compliance officer as member...");
  const complianceOfficer = "0x0000000000000000000000000000000000000042";
  const memberTx = await institution.write.addMember([complianceOfficer]);
  await publicClient.waitForTransactionReceipt({ hash: memberTx });
  const memberCount = await institution.read.getMemberCount();
  console.log(`  ✓ Member added — total members: ${memberCount}`);
  console.log("");

  // ── Step 4: Create KYC process through the institution ─────────
  console.log("▸ Creating 'KYC Verification' process via institution...");
  const procTx = await institution.write.createProcess([
    "KYC Verification",
    "Standard institutional KYC verification process for onboarding",
    ["Document Submission", "Identity Verification", "Compliance Review", "Approval"],
    [
      "Client submits identity documents and proof of address",
      "Automated identity verification against government databases",
      "Compliance officer reviews results and flags any issues",
      "Final approval or rejection by authorized signatory",
    ],
    ["submission", "verification", "approval", "signature"],
    [
      '{"required_docs":["passport","proof_of_address","source_of_funds"]}',
      '{"provider":"automated","confidence_threshold":0.95}',
      '{"role":"compliance_officer","timeout_hours":48}',
      '{"role":"authorized_signatory","multi_sig":false}',
    ],
  ]);

  const procReceipt = await publicClient.waitForTransactionReceipt({ hash: procTx });
  console.log(`  ✓ Template deployed via institution (gas: ${procReceipt.gasUsed})`);

  const processes = await institution.read.getProcesses();
  const templateAddr = processes[0];
  console.log(`  ✓ ProcessTemplate at ${templateAddr}`);
  console.log(`    Institution process count: ${await institution.read.getProcessCount()}`);
  console.log("");

  // ── Step 5: Instantiate and execute the process ────────────────
  const template = await connection.viem.getContractAt("ProcessTemplate", templateAddr);
  const stepCount = await template.read.getStepCount();
  console.log(`▸ Template has ${stepCount} steps`);

  console.log("▸ Creating process instance...");
  const createInstTx = await template.write.instantiate();
  await publicClient.waitForTransactionReceipt({ hash: createInstTx });

  const userInstances = await template.read.getUserInstances([deployer.account.address]);
  const instanceAddr = userInstances[0];
  console.log(`  ✓ ProcessInstance at ${instanceAddr}`);
  console.log("");

  const instance = await connection.viem.getContractAt("ProcessInstance", instanceAddr);

  // Execute each step
  const stepData = [
    '{"documents":["passport_hash_0xabc...","address_proof_hash_0xdef..."]}',
    '{"verified":true,"confidence":0.98,"provider":"citrea_kyc_oracle"}',
    '{"reviewed_by":"compliance_officer","flags":[],"risk_level":"low"}',
    '{"approved":true,"signatory":"authorized_signatory","date":"2025-06-28"}',
  ];

  for (let i = 0; i < Number(stepCount); i++) {
    const [stepName] = await template.read.getStep([BigInt(i)]);
    console.log(`▸ Executing step ${i + 1}/${stepCount}: "${stepName}"...`);

    const execTxHash = await instance.write.executeStep([1, stepData[i]]); // 1 = Completed
    const execReceipt = await publicClient.waitForTransactionReceipt({ hash: execTxHash });
    console.log(`  ✓ Completed (gas: ${execReceipt.gasUsed})`);
  }

  const isCompleted = await instance.read.isCompleted();
  console.log(`\n  ✓ Process completed: ${isCompleted}`);
  console.log("");

  // ── Step 6: Bitcoin awareness (Citrea testnet only) ────────────
  if (chainId === 5115) {
    console.log("▸ Querying Bitcoin state via Citrea Light Client (no contract needed)...");

    try {
      // Query Citrea-specific RPCs for finality info
      const lastCommitted = await publicClient.request({
        method: "citrea_getLastCommittedL2Height" as any,
        params: [] as any,
      });
      console.log(`  Last committed L2 height: ${JSON.stringify(lastCommitted)}`);

      const lastProven = await publicClient.request({
        method: "citrea_getLastProvenL2Height" as any,
        params: [] as any,
      });
      console.log(`  Last proven L2 height:    ${JSON.stringify(lastProven)}`);

      // Find the latest Bitcoin block known to Citrea's light client
      async function findLatestBtcBlock(): Promise<bigint> {
        let low = 100000n;
        let high = 200000n;
        while (true) {
          const h = await publicClient.readContract({
            address: LIGHT_CLIENT,
            abi: lightClientAbi,
            functionName: "getBlockHash",
            args: [high],
          });
          if (h === ZERO_HASH) break;
          high *= 2n;
        }
        while (low < high) {
          const mid = (low + high + 1n) / 2n;
          const h = await publicClient.readContract({
            address: LIGHT_CLIENT,
            abi: lightClientAbi,
            functionName: "getBlockHash",
            args: [mid],
          });
          if (h !== ZERO_HASH) { low = mid; } else { high = mid - 1n; }
        }
        return low;
      }

      const latestBtcBlock = await findLatestBtcBlock();
      const latestBtcHash = await publicClient.readContract({
        address: LIGHT_CLIENT,
        abi: lightClientAbi,
        functionName: "getBlockHash",
        args: [latestBtcBlock],
      }) as `0x${string}`;
      const hashLE = latestBtcHash.slice(2);
      const hashBE = hashLE.match(/.{2}/g)!.reverse().join("");
      console.log(`  Latest BTC block in light client: ${latestBtcBlock}`);
      console.log(`  BTC block hash: ${hashBE}`);
      console.log(`  Verify: https://mempool.space/testnet4/block/${latestBtcBlock}`);
      console.log("");
      console.log("  Bitcoin awareness is handled off-chain.");
      console.log("  No BitcoinAnchor contract needed -- the Light Client");
      console.log("  at 0x3100...0001 is readable via free eth_call.");
    } catch (err: any) {
      console.log(`  Warning: Bitcoin query skipped (light client may not be reachable)`);
      console.log(`    Error: ${err.message?.slice(0, 100)}`);
    }
  } else {
    console.log("▸ Skipping Bitcoin awareness (not on Citrea testnet)");
  }

  // ── Summary ────────────────────────────────────────────────────
  console.log("");
  console.log("═══════════════════════════════════════════════════════");
  console.log("  Demo Complete!");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  BINSTDeployer:   ${binstDeployer.address}`);
  console.log(`  Institution:     ${institutionAddr}`);
  console.log(`    Name:          Acme Financial Services`);
  console.log(`    btcPubkey:     ${await institution.read.btcPubkey()}`);
  console.log(`    inscriptionId: ${await institution.read.inscriptionId()}`);
  console.log(`    runeId:        ${await institution.read.runeId()}`);
  console.log(`    Vault:         ${vaultAddress}`);
  console.log(`    Members:       ${memberCount}`);
  console.log(`    Processes:     ${await institution.read.getProcessCount()}`);
  console.log(`  ProcessTemplate: ${templateAddr}`);
  console.log(`  ProcessInstance: ${instanceAddr}`);
  console.log(`  Process status:  ${isCompleted ? "COMPLETED" : "IN PROGRESS"}`);
  if (chainId === 5115) {
    console.log(`  Network:         Citrea Testnet (chain 5115)`);
    console.log(`  Bitcoin:         Light Client at ${LIGHT_CLIENT} (queried directly)`);
    console.log(`  Finality:        Citrea RPCs (off-chain monitoring)`);
  }
  console.log("═══════════════════════════════════════════════════════");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
