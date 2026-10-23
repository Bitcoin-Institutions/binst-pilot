/**
 * Deploy BINSTProcessFactory to Citrea testnet.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-factory-citrea.ts --network citreaTestnet
 *
 * This is the "Thin L2" deployment: only the factory contract.
 * Instances are created from the webapp when users execute process templates.
 */
import hre from "hardhat";

async function main() {
  const connection = await hre.network.connect();
  const publicClient = await connection.viem.getPublicClient();
  const [deployer] = await connection.viem.getWalletClients();

  const chainId = await publicClient.getChainId();
  if (chainId !== 5115) {
    throw new Error(`Expected Citrea Testnet (chain 5115), connected to chain ${chainId}. Aborting.`);
  }

  console.log("Network:  Citrea Testnet (chain 5115)");
  console.log("Deployer:", deployer.account.address);

  const balance = await publicClient.getBalance({ address: deployer.account.address });
  console.log("Balance: ", (Number(balance) / 1e18).toFixed(6), "cBTC");
  console.log("");

  // Deploy the factory
  console.log("Deploying BINSTProcessFactory…");
  const factory = await connection.viem.deployContract("BINSTProcessFactory");
  console.log("");
  console.log("════════════════════════════════════════════════════════");
  console.log("  BINSTProcessFactory deployed!");
  console.log("  Address:", factory.address);
  console.log("════════════════════════════════════════════════════════");
  console.log("");

  // Verify instance count is 0
  const count = await factory.read.getInstanceCount();
  console.log(`Instance count: ${count} (fresh factory) ✓`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Copy the factory address above");
  console.log("  2. Update CITREA_FACTORY_ADDRESS in webapp/src/storage.rs");
  console.log("  3. The webapp will auto-populate the factory address on boot");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
