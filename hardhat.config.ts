import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import * as dotenv from "dotenv";
import { ProxyAgent, setGlobalDispatcher } from "undici";

const proxyAgent = new ProxyAgent("http://127.0.0.1:7899");
setGlobalDispatcher(proxyAgent);

dotenv.config();

const config: HardhatUserConfig = {
  sourcify: {
    enabled: true
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
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY ?? "",
      // bscTestnet: process.env.BSCSCAN_API_KEY ?? "",
      // baseSepolia: process.env.BASESCAN_API_KEY ?? "",
      // ethereum: process.env.ETHERSCAN_API_KEY ?? "",
      // bsc: process.env.BSCSCAN_API_KEY ?? "",
      // base: process.env.BASESCAN_API_KEY ?? "",
    },
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
  },
};

export default config;
