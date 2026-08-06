import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades"; // ❗❗❗When verify contract, disabled it
import * as dotenv from "dotenv";
import "hardhat-deploy";
import type { HardhatUserConfig } from "hardhat/config";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const proxyAgent = new ProxyAgent("http://127.0.0.1:7890");
setGlobalDispatcher(proxyAgent);

dotenv.config();

const config: HardhatUserConfig = {
  // Sourcify API v1 is in brownout (503); Basescan/Etherscan verify is enough.
  sourcify: {
    enabled: false,
  },
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  etherscan: {
    // Etherscan API v2: one key works across chains; apiURL must include chainid.
    apiKey: process.env.ETHERSCAN_API_KEY ?? process.env.BASESCAN_API_KEY ?? "",
    customChains: [
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=84532",
          browserURL: "https://sepolia.basescan.org",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=8453",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "sepolia",
        chainId: 11155111,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=11155111",
          browserURL: "https://sepolia.etherscan.io",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./tests",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    sepolia: {
      chainId: 11155111,
      url: "https://eth-sepolia.api.onfinality.io/public",
      accounts: {
        mnemonic: process.env.MNEMONICS,
      },
    },
    "base-sepolia": {
      chainId: 84532,
      url: "https://sepolia.base.org",
      accounts: {
        mnemonic: process.env.MNEMONICS,
      },
    },
    base: {
      chainId: 8453,
      url: "https://mainnet.base.org",
      accounts:
        process.env.DEPLOY_OR_UPGRADE === "deploy"
          ? [process.env.DEPLOYER_PRIVATE_KEY!]
          : [process.env.UPGRADER_PRIVATE_KEY!],
    },
  },
};

export default config;
