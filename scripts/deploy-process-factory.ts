/**
 * Deploy BINSTProcessFactory to a local Hardhat node and create a sample instance.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-process-factory.ts --network localhost
 *
 * This is the "Thin L2" deployment: only a factory + instances.
 * No Institution or ProcessTemplate contracts needed — those live on Bitcoin L1.
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
  console.log("");

  // 1. Deploy the factory
  const factory = await connection.viem.deployContract("BINSTProcessFactory");
  console.log("BINSTProcessFactory:", factory.address);

  // 2. Create a sample instance (simulating what the webapp will do)
  //    The template inscription ID and steps come from the L1 inscription body.
  const sampleTemplateInscriptionId =
    "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2i0";

  const txHash = await factory.write.createInstance([
    sampleTemplateInscriptionId,
    ["Submit Document", "Review & Approve", "Final Sign-off"],
    ["submission", "approval", "signature"],
  ]);

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log("createInstance tx:", txHash);

  // 3. Read the instance address from the factory
  const instances = await factory.read.getUserInstances([deployer.account.address]);
  const instanceAddress = instances[0];

  // 4. Verify it works
  const instance = await connection.viem.getContractAt("BINSTProcess", instanceAddress);
  const stepCount = await instance.read.getStepCount();
  const templateId = await instance.read.templateInscriptionId();

  console.log("");
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  BINSTProcessFactory:  ", factory.address);
  console.log("  BINSTProcess instance:", instanceAddress);
  console.log("  Template inscription: ", templateId.slice(0, 16) + "…");
  console.log("  Steps:                ", stepCount.toString());
  console.log("═══════════════════════════════════════════════════════════");
  console.log("");
  console.log("Webapp integration:");
  console.log(`  Factory address → store in webapp config`);
  console.log(`  Instance address → written to #execute-instance-address after createInstance()`);
  console.log("");
  console.log("MetaMask local network:");
  console.log(`  RPC URL:  http://127.0.0.1:8545`);
  console.log(`  Chain ID: 31337`);
  console.log(`  Currency: ETH`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
