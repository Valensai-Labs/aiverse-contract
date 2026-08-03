/*
npx hardhat run scripts/activity-manager/base-sepolia/deploy.ts --network base-sepolia

Env (optional overrides):
  ACTIVITY_NODE_MANAGER
  ACTIVITY_POWER_ASSET
*/

import { expect } from "chai";
import "dotenv/config";
import hre from "hardhat";
import {
  deployTransparentProxyWithInit,
  optionalAddressEnv,
} from "../../deploy-utils/atomicProxyDeploy";

/** Known Base Sepolia proxies */
const DEFAULT_NODE_MANAGER = "0x01Bb8CE193Cf0fcb7f1Aa9547aCCacc7af00b405";
const DEFAULT_POWER_ASSET = "0x0bba8Ba13eE178Ae87a22E9e8aB2d2e033233cD8";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  const nodeManager = optionalAddressEnv(
    "ACTIVITY_NODE_MANAGER",
    DEFAULT_NODE_MANAGER
  );
  const powerAsset = optionalAddressEnv(
    "ACTIVITY_POWER_ASSET",
    DEFAULT_POWER_ASSET
  );

  console.log(`Deployer:    ${deployerAddress}`);
  console.log(`NodeManager: ${nodeManager}`);
  console.log(`PowerAsset:  ${powerAsset}`);

  const { proxyAddress, implementationAddress, proxyAdminAddress } =
    await deployTransparentProxyWithInit(
      hre,
      deployer,
      "ActivityManager",
      [nodeManager, powerAsset],
      deployerAddress
    );

  console.log(`Proxy:          ${proxyAddress}`);
  console.log(`Implementation: ${implementationAddress}`);
  console.log(`ProxyAdmin:     ${proxyAdminAddress}`);
  console.log(
    "Update scripts/activity-manager/base-sepolia/deployedAddr.json with the addresses above."
  );

  const activityManagerTyped = await hre.ethers.getContractAt(
    "ActivityManager",
    proxyAddress
  );
  expect(await activityManagerTyped.version()).to.equal("1.0.0");
  expect(await activityManagerTyped.nodeManager()).to.equal(nodeManager);
  expect(await activityManagerTyped.powerAsset()).to.equal(powerAsset);
  console.log("Version and initialization verification successful!");
  console.log(
    "Post-deploy: setFoundationSigner, setMaxMint, setMinClaim; then PowerAsset.setActivityClaimManager(proxy)."
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
