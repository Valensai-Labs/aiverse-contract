/*
npx hardhat run scripts/aiverse-coin/eth-sepolia/verify.ts --network sepolia
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

  const implementationAddr = networkAddrs["AiverseCoinV1_0_1"];
  const proxyAddr = networkAddrs["AiverseCoinProxy"];

  if (!implementationAddr) {
    throw new Error(`AiverseCoinV1_0_1 address not found for network ${networkName}`);
  }
  if (!proxyAddr) {
    throw new Error(`AiverseCoinProxy address not found for network ${networkName}`);
  }

  console.log(`Verifying contracts on ${networkName}...`);
  console.log("AiverseCoinV1_0_1 address:", implementationAddr);
  console.log("AiverseCoinProxy address:", proxyAddr);

  const [deployer] = await ethers.getSigners();
  await verifyOne("AiverseCoinV1_0_1 implementation", implementationAddr, []);
  await verifyOne("TransparentUpgradeableProxy", proxyAddr, [
    implementationAddr,
    deployer.address,
    "0x",
  ]);

  console.log("\nAll AiverseCoin contracts verified successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Contract verification failed:", error);
    process.exit(1);
  });
