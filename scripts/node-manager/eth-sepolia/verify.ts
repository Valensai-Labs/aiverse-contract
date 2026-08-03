/*
npx hardhat run scripts/node-manager/eth-sepolia/verify.ts --network sepolia
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

  const implementationAddr = networkAddrs["NodeManagerV1_0_1"];
  const proxyAddr = networkAddrs["NodeManagerProxy"];

  if (!implementationAddr) {
    throw new Error(`NodeManagerV1_0_1 address not found for network ${networkName}`);
  }
  if (!proxyAddr) {
    throw new Error(`NodeManagerProxy address not found for network ${networkName}`);
  }

  console.log(`Verifying contracts on ${networkName}...`);
  console.log("NodeManagerV1_0_1 address:", implementationAddr);
  console.log("NodeManagerProxy address:", proxyAddr);

  const [deployer] = await ethers.getSigners();
  await verifyOne("NodeManagerV1_0_1 implementation", implementationAddr, []);
  await verifyOne("TransparentUpgradeableProxy", proxyAddr, [
    implementationAddr,
    deployer.address,
    "0x",
  ]);

  console.log("\nAll NodeManager contracts verified successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Contract verification failed:", error);
    process.exit(1);
  });
