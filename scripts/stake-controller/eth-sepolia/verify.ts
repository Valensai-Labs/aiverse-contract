/*
npx hardhat run scripts/stake-controller/eth-sepolia/verify.ts --network sepolia
*/

import * as fs from "fs";
import { ethers, network } from "hardhat";
import * as path from "path";
import { verifyOne } from "../../deploy-utils/verify";

async function main() {
  const addressPath = path.join(__dirname, "./deployedAddr.json");
  const addresses = JSON.parse(fs.readFileSync(addressPath, "utf8"));
  const networkName = network.name;
  const networkAddrs = addresses[networkName];
  if (!networkAddrs) {
    throw new Error(`No addresses found for network ${networkName}`);
  }

  const implementationAddr = networkAddrs["StakeControllerV1_0_5"];
  const proxyAddr = networkAddrs["StakeControllerProxy"];

  if (!implementationAddr) {
    throw new Error(`StakeControllerV1_0_5 address not found for network ${networkName}`);
  }
  if (!proxyAddr) {
    throw new Error(`StakeControllerProxy address not found for network ${networkName}`);
  }

  console.log(`Verifying contracts on ${networkName}...`);
  console.log("StakeControllerV1_0_5 address:", implementationAddr);
  console.log("StakeControllerProxy address:", proxyAddr);

  const [deployer] = await ethers.getSigners();
  await verifyOne("StakeControllerV1_0_5 implementation", implementationAddr, []);
  await verifyOne("TransparentUpgradeableProxy", proxyAddr, [
    implementationAddr,
    deployer.address,
    "0x",
  ]);

  console.log("\nAll StakeController contracts verified successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Contract verification failed:", error);
    process.exit(1);
  });
