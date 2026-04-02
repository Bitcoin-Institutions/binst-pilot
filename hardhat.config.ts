import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.24",
        settings: {
          evmVersion: "shanghai",
          optimizer: {
            enabled: true,
            runs: 50,
          },
        },
      },
      production: {
        version: "0.8.24",
        settings: {
          evmVersion: "shanghai",
          optimizer: {
            enabled: true,
            runs: 50,
          },
        },
      },
    },
  },
  chainDescriptors: {
    5115: {
      name: "Citrea Testnet",
      blockExplorers: {
        blockscout: {
          url: "https://explorer.testnet.citrea.xyz",
          apiUrl: "https://explorer.testnet.citrea.xyz/api",
        },
      },
    },
    4114: {
      name: "Citrea Mainnet",
      blockExplorers: {
        blockscout: {
          url: "https://explorer.citrea.xyz",
          apiUrl: "https://explorer.citrea.xyz/api",
        },
      },
    },
  },
  networks: {
    hardhatLocal: {
      type: "edr-simulated",
      chainType: "l1",
    },
    citreaTestnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("CITREA_TESTNET_RPC_URL"),
      accounts: [configVariable("CITREA_PRIVATE_KEY")],
    },
    citreaMainnet: {
      type: "http",
      chainType: "l1",
      url: configVariable("CITREA_MAINNET_RPC_URL"),
      accounts: [configVariable("CITREA_PRIVATE_KEY")],
    },
  },
});
