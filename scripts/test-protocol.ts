import hre from "hardhat";
import { formatEther, parseAbi } from "viem";

/**
 * test-protocol.ts — Test the live BINST protocol on Citrea Testnet
 *
 * Interacts with the already-deployed & verified contracts to:
 * 1. Read deployed process templates from BINSTDeployer
 * 2. Query the KYC template metadata and step details
 * 3. Query the completed ProcessInstance state
 * 4. Query Bitcoin Light Client directly (no wrapper contract)
 * 5. Query Citrea finality RPCs to prove Bitcoin commitment
 *
 * Architecture note:
 *   Only protocol-critical contracts are on-chain (Deployer, Template, Instance).
 *   Bitcoin awareness is off-chain via direct eth_call to 0x3100...0001.
 *
 * Usage:
 *   npx hardhat run scripts/test-protocol.ts --network citreaTestnet
 */

const LIGHT_CLIENT = "0x3100000000000000000000000000000000000001" as const;

const lightClientAbi = parseAbi([
  "function getBlockHash(uint256 blockNumber) external view returns (bytes32)",
  "function getWitnessRootByNumber(uint256 blockNumber) external view returns (bytes32)",
]);

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000";

// Deployed contract addresses (Citrea Testnet)
const ADDRESSES = {
  binstDeployer: "0x46c505d38e9009a16398f268e26dff6844ef59d5" as const,
  processTemplate: "0x3A6A07C5D2C420331f68DD407AaFff92f3275a86" as const,
  processInstance: "0x2066B17e0e6bD9AB1bbC76A146f68eBfca7C6f4f" as const,
};

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();
  const [wallet] = await connection.viem.getWalletClients();
  const chainId = await publicClient.getChainId();

  console.log("═══════════════════════════════════════════════════════");
  console.log("  BINST Protocol — Live Testnet Verification");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  Chain:   Citrea Testnet (${chainId})`);
  console.log(`  Wallet:  ${wallet.account.address}`);
  const balance = await publicClient.getBalance({ address: wallet.account.address });
  console.log(`  Balance: ${formatEther(balance)} cBTC`);
  console.log("");

  // ── 1. Query BINSTDeployer registry ────────────────────────────
  console.log("━━━ 1. BINSTDeployer Registry ━━━━━━━━━━━━━━━━━━━━━━━");
  const deployer = await connection.viem.getContractAt("BINSTDeployer", ADDRESSES.binstDeployer);
  const processCount = await deployer.read.getDeployedProcessCount();
  const processes = await deployer.read.getDeployedProcesses();
  console.log(`  Registered templates: ${processCount}`);
  for (let i = 0; i < processes.length; i++) {
    console.log(`    [${i}] ${processes[i]}`);
  }
  console.log("");

  // ── 2. Query ProcessTemplate metadata ──────────────────────────
  console.log("━━━ 2. ProcessTemplate: KYC Verification ━━━━━━━━━━━━");
  const template = await connection.viem.getContractAt("ProcessTemplate", ADDRESSES.processTemplate);
  const [tName, tDesc, tCreator, stepCount, instCount] = await Promise.all([
    template.read.name(),
    template.read.description(),
    template.read.creator(),
    template.read.getStepCount(),
    template.read.instantiationCount(),
  ]);
  console.log(`  Name:          ${tName}`);
  console.log(`  Description:   ${tDesc}`);
  console.log(`  Creator:       ${tCreator}`);
  console.log(`  Steps:         ${stepCount}`);
  console.log(`  Instances:     ${instCount}`);
  console.log("");

  console.log("  Step details:");
  for (let i = 0; i < Number(stepCount); i++) {
    const [sName, sDesc, sAction, sConfig] = await template.read.getStep([BigInt(i)]);
    console.log(`    Step ${i + 1}: "${sName}" [${sAction}]`);
    console.log(`           ${sDesc}`);
    console.log(`           config: ${sConfig}`);
  }
  console.log("");

  // ── 3. Query ProcessInstance state ─────────────────────────────
  console.log("━━━ 3. ProcessInstance: Execution State ━━━━━━━━━━━━━");
  const instance = await connection.viem.getContractAt("ProcessInstance", ADDRESSES.processInstance);
  const [iTemplate, iCreator, currentStep, totalSteps, completed, createdAt] = await Promise.all([
    instance.read.template(),
    instance.read.creator(),
    instance.read.currentStepIndex(),
    instance.read.totalSteps(),
    instance.read.isCompleted(),
    instance.read.createdAt(),
  ]);
  console.log(`  Template:      ${iTemplate}`);
  console.log(`  Creator:       ${iCreator}`);
  console.log(`  Progress:      ${currentStep}/${totalSteps} steps`);
  console.log(`  Completed:     ${completed ? "✅ YES" : "⏳ NO"}`);
  console.log(`  Created at:    ${new Date(Number(createdAt) * 1000).toISOString()}`);
  console.log("");

  console.log("  Step execution history:");
  for (let i = 0; i < Number(totalSteps); i++) {
    const [status, actor, data, timestamp] = await instance.read.getStepState([BigInt(i)]);
    const statusLabel = ["Pending", "Completed", "Rejected"][Number(status)];
    const [sName] = await template.read.getStep([BigInt(i)]);
    console.log(`    Step ${i + 1} "${sName}": ${statusLabel}`);
    console.log(`      Actor:     ${actor}`);
    console.log(`      Timestamp: ${timestamp > 0n ? new Date(Number(timestamp) * 1000).toISOString() : "—"}`);
    console.log(`      Data:      ${data || "—"}`);
  }
  console.log("");

  // ── 4. Query Bitcoin Light Client directly (no wrapper contract) ─
  console.log("━━━ 4. Bitcoin Light Client (direct eth_call) ━━━━━━━");

  // Binary search for the latest BTC block in the light client
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
  console.log(`  Hash (BTC format): ${hashBE}`);
  console.log(`  Verify: https://mempool.space/testnet4/block/${latestBtcBlock}`);

  // Sample a few historical blocks
  const sampleBlocks = [latestBtcBlock - 100n, latestBtcBlock - 1000n, 1n];
  for (const blockNum of sampleBlocks) {
    if (blockNum < 1n) continue;
    const hash = await publicClient.readContract({
      address: LIGHT_CLIENT,
      abi: lightClientAbi,
      functionName: "getBlockHash",
      args: [blockNum],
    });
    const available = hash !== ZERO_HASH;
    console.log(`  BTC block ${blockNum}: ${available ? "✅" : "❌ not available"}`);
  }
  console.log("");

  console.log("  📋 No BitcoinAnchor contract needed.");
  console.log("     Light Client at 0x3100...0001 is readable via free eth_call.");
  console.log("");

  // ── 5. Citrea Finality RPCs ────────────────────────────────────
  console.log("━━━ 5. Citrea Finality Status ━━━━━━━━━━━━━━━━━━━━━━━");
  try {
    const lastCommitted = await publicClient.request({
      method: "citrea_getLastCommittedL2Height" as any,
      params: [] as any,
    });
    console.log(`  Last committed L2 height: ${JSON.stringify(lastCommitted)}`);
  } catch (e: any) {
    console.log(`  Committed height query: ${e.message?.slice(0, 80)}`);
  }

  try {
    const lastProven = await publicClient.request({
      method: "citrea_getLastProvenL2Height" as any,
      params: [] as any,
    });
    console.log(`  Last proven L2 height:    ${JSON.stringify(lastProven)}`);
  } catch (e: any) {
    console.log(`  Proven height query: ${e.message?.slice(0, 80)}`);
  }

  // ── 6. Live Protocol Test: New Instance ─────────────────────────
  console.log("");
  console.log("━━━ 6. Live Protocol Test: New Instance ━━━━━━━━━━━━━");
  console.log("▸ Creating new process instance from KYC template...");

  const instTxHash = await template.write.instantiate();
  const instReceipt = await publicClient.waitForTransactionReceipt({ hash: instTxHash });
  console.log(`  ✓ TX: ${instTxHash}`);
  console.log(`    Block: ${instReceipt.blockNumber}, Gas: ${instReceipt.gasUsed}`);

  const userInstances = await template.read.getUserInstances([wallet.account.address]);
  const newInstanceAddr = userInstances[userInstances.length - 1];
  console.log(`  ✓ New ProcessInstance at ${newInstanceAddr}`);

  const newInstance = await connection.viem.getContractAt("ProcessInstance", newInstanceAddr);

  // Execute first two steps
  console.log("▸ Executing Step 1: Document Submission...");
  let tx = await newInstance.write.executeStep([
    1, // Completed
    '{"documents":["passport_0xfeed...","address_proof_0xbeef..."],"submitted_at":"2026-03-28T22:30:00Z"}',
  ]);
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log(`  ✓ Step 1 completed (tx: ${tx.slice(0, 20)}...)`);

  console.log("▸ Executing Step 2: Identity Verification...");
  tx = await newInstance.write.executeStep([
    1,
    '{"verified":true,"confidence":0.97,"method":"biometric+document","provider":"citrea_kyc"}',
  ]);
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log(`  ✓ Step 2 completed (tx: ${tx.slice(0, 20)}...)`);

  console.log("▸ Executing Step 3: Compliance Review...");
  tx = await newInstance.write.executeStep([
    1,
    '{"reviewer":"compliance_officer_alpha","risk_score":12,"flags":[],"decision":"clear"}',
  ]);
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log(`  ✓ Step 3 completed (tx: ${tx.slice(0, 20)}...)`);

  console.log("▸ Executing Step 4: Final Approval...");
  tx = await newInstance.write.executeStep([
    1,
    '{"approved":true,"signatory":"authorized_signatory_01","timestamp":"2026-03-28T22:35:00Z"}',
  ]);
  await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log(`  ✓ Step 4 completed (tx: ${tx.slice(0, 20)}...)`);

  const newCompleted = await newInstance.read.isCompleted();
  console.log(`\n  Process completed: ${newCompleted ? "✅ YES" : "❌ NO"}`);

  // Final balance
  const finalBalance = await publicClient.getBalance({ address: wallet.account.address });
  console.log(`\n  Final balance: ${formatEther(finalBalance)} cBTC`);

  console.log("");
  console.log("═══════════════════════════════════════════════════════");
  console.log("  ✅ BINST Protocol — Live on Bitcoin (via Citrea)");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`  New instance:  ${newInstanceAddr}`);
  console.log(`  All verified on: https://explorer.testnet.citrea.xyz`);
  console.log("═══════════════════════════════════════════════════════");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
