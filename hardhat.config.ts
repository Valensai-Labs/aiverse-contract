import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-deploy";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./tests",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    // hardhat: {},
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
