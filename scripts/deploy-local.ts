/**
 * Deploy BINSTDeployer + a sample ProcessTemplate to a local Hardhat node.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-local.ts --network localhost
 *
 * Prints the deployed addresses so you can paste into the webapp.
 */
import hre from "hardhat";

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();
  const [deployer] = await connection.viem.getWalletClients();

  const chainId = await publicClient.getChainId();
  if (chainId !== 31337) {
    throw new Error(`This script is for a local Hardhat node (chain 31337), connected to chain ${chainId}. Aborting.`);
  }

  console.log("Deployer:", deployer.account.address);

  // 1. Deploy BINSTDeployer
  const binstDeployer = await connection.viem.deployContract("BINSTDeployer");
  console.log("BINSTDeployer:", binstDeployer.address);

  // 2. Create a sample ProcessTemplate via BINSTDeployer.deployProcess()
  const txHash = await binstDeployer.write.deployProcess([
    "Document Approval",
    "A 3-step document approval workflow for testing",
    ["Submit Document", "Review & Approve", "Final Sign-off"],
    ["Author submits the document for review", "Reviewer checks and approves", "Final authority signs off"],
    ["submission", "approval", "signature"],
    ["{}", "{}", "{}"],
  ]);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log("deployProcess tx:", txHash);

  // 3. Read deployed processes to get the template address
  const processes = await binstDeployer.read.getDeployedProcesses();
  const templateAddress = processes[0];
  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("  ProcessTemplate address:", templateAddress);
  console.log("═══════════════════════════════════════════");
  console.log("");
  console.log("Paste this address in the webapp Process Detail view");
  console.log("to link it and start creating instances.");

  // 4. Verify it works — read step count
  const template = await connection.viem.getContractAt("ProcessTemplate", templateAddress);
  const stepCount = await template.read.getStepCount();
  console.log(`Template has ${stepCount} steps ✓`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
