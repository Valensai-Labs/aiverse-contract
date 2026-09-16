/*
npx hardhat run scripts/power-asset/base/verify.ts --network base
*/

import * as fs from "fs";
import { ethers } from "hardhat";
import * as path from "path";
import { verifyTransparentProxyStack } from "../../deploy-utils/verify";

async function main() {
  const addressPath = path.join(__dirname, "./deployedAddr.json");
  if (!fs.existsSync(addressPath)) {
    console.error("Error: deployedAddr.json not found in the same directory.");
    process.exit(1);
  }
  const addresses = JSON.parse(fs.readFileSync(addressPath, "utf8"));

  const {
    PowerAssetV1_0_10: implementationAddr,
    PowerAssetProxy: proxyAddr,
    PowerAssetProxyAdmin: proxyAdminAddr,
  } = addresses.base;

  if (!implementationAddr || !proxyAddr || !proxyAdminAddr) {
    console.error(
      "Error: One or more contract addresses are missing from deployedAddr.json."
    );
    console.error(`Implementation Address: ${implementationAddr}`);
    console.error(`Proxy Address: ${proxyAddr}`);
    console.error(`Proxy Admin Address: ${proxyAdminAddr}`);
    process.exit(1);
  }

  console.log("Starting verification process for PowerAsset...");
  console.log(
    `Verifying PowerAssetV1_0_10 (Implementation): ${implementationAddr}`
  );
  console.log(`Verifying TransparentUpgradeableProxy (Proxy): ${proxyAddr}`);
  console.log(`Verifying ProxyAdmin (Admin): ${proxyAdminAddr}`);

  const [deployer] = await ethers.getSigners();
  await verifyTransparentProxyStack({
    implementationLabel: "PowerAssetV1_0_10 implementation",
    implementationAddr,
    proxyAddr,
    proxyAdminAddr,
    proxyAdminOwner: deployer.address,
  });

  console.log("\nAll PowerAsset contracts verified successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Contract verification failed:", error);
    process.exit(1);
  });
