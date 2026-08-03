/*
npx hardhat run scripts/power-asset/eth-sepolia/verify.ts --network sepolia
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

  const implementationAddr = networkAddrs["PowerAssetV1_0_2"];
  const proxyAddr = networkAddrs["PowerAssetProxy"];

  if (!implementationAddr) {
    throw new Error(`PowerAssetV1_0_2 address not found for network ${networkName}`);
  }
  if (!proxyAddr) {
    throw new Error(`PowerAssetProxy address not found for network ${networkName}`);
  }

  console.log(`Verifying contracts on ${networkName}...`);
  console.log("PowerAssetV1_0_2 address:", implementationAddr);
  console.log("PowerAssetProxy address:", proxyAddr);

  const [deployer] = await ethers.getSigners();
  await verifyOne("PowerAssetV1_0_2 implementation", implementationAddr, []);
  await verifyOne("TransparentUpgradeableProxy", proxyAddr, [
    implementationAddr,
    deployer.address,
    "0x",
  ]);

  console.log("\nAll PowerAsset contracts verified successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Contract verification failed:", error);
    process.exit(1);
  });
