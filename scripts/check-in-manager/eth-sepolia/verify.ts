/*
npx hardhat run scripts/check-in-manager/eth-sepolia/verify.ts --network sepolia
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

  const implementationAddr = networkAddrs["CheckInManagerV1_0_2"];
  const proxyAddr = networkAddrs["CheckInManagerProxy"];

  if (!implementationAddr) {
    throw new Error(`CheckInManagerV1_0_2 address not found for network ${networkName}`);
  }
  if (!proxyAddr) {
    throw new Error(`CheckInManagerProxy address not found for network ${networkName}`);
  }

  console.log(`Verifying contracts on ${networkName}...`);
  console.log("CheckInManagerV1_0_2 address:", implementationAddr);
  console.log("CheckInManagerProxy address:", proxyAddr);

  const [deployer] = await ethers.getSigners();
  await verifyOne("CheckInManagerV1_0_2 implementation", implementationAddr, []);
  await verifyOne("TransparentUpgradeableProxy", proxyAddr, [
    implementationAddr,
    deployer.address,
    "0x",
  ]);

  console.log("\nAll CheckInManager contracts verified successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Contract verification failed:", error);
    process.exit(1);
  });
