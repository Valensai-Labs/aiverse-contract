/*
  ActivityManager was deployed via atomicProxyDeploy (not Ignition). Do NOT use
  ignition upgrade-module — it would spawn a new proxy stack.

  npx hardhat run scripts/activity-manager/base/upgrade.ts --network base
*/

import { expect } from "chai";
import * as fs from "fs";
import hre from "hardhat";
import * as path from "path";

const NETWORK_KEY = "base";
const NEW_IMPL_NAME = "ActivityManagerV1_0_1";
const EXPECTED_VERSION = "1.0.1";

async function main() {
  const [account] = await hre.ethers.getSigners();
  const addressPath = path.join(__dirname, "./deployedAddr.json");
  const addresses = JSON.parse(fs.readFileSync(addressPath, "utf8"));
  const net = addresses[NETWORK_KEY];

  const proxyAddr = net?.ActivityManagerProxy as string | undefined;
  const proxyAdminAddr = net?.ActivityManagerProxyAdmin as string | undefined;
  if (!proxyAddr || !proxyAdminAddr) {
    throw new Error(
      `Missing ActivityManagerProxy / ActivityManagerProxyAdmin in deployedAddr.json (${NETWORK_KEY})`,
    );
  }

  console.log(`Signer:     ${account.address}`);
  console.log(`Proxy:      ${proxyAddr}`);
  console.log(`ProxyAdmin: ${proxyAdminAddr}`);

  const factory = await hre.ethers.getContractFactory(NEW_IMPL_NAME);
  const impl = await factory.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log(`New impl:   ${implAddr}`);

  const proxyAdmin = await hre.ethers.getContractAt(
    "ProxyAdmin",
    proxyAdminAddr,
  );
  const upgradeTx = await proxyAdmin
    .connect(account)
    .upgradeAndCall(proxyAddr, implAddr, "0x");
  console.log(`upgradeAndCall tx: ${upgradeTx.hash}`);
  await upgradeTx.wait();

  const activityManager = await hre.ethers.getContractAt(
    NEW_IMPL_NAME,
    proxyAddr,
  );
  const version = await activityManager.connect(account).version();
  expect(version).to.equal(EXPECTED_VERSION);
  console.log(`Proxy version: ${version}`);

  net[NEW_IMPL_NAME] = implAddr;
  fs.writeFileSync(addressPath, `${JSON.stringify(addresses, null, 2)}\n`);
  console.log(`Updated ${addressPath} → ${NEW_IMPL_NAME}=${implAddr}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
