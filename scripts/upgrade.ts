/*
CONTRACT=aiverse-coin npx hardhat run scripts/upgrade.ts --network base

On base and base-sepolia set DEPLOY_OR_UPGRADE=upgrade so the signer is
UPGRADER_PRIVATE_KEY, which must own ProxyAdmin.

Ignition upgrades keep the original module ids. Direct upgrades deploy a new
implementation and call ProxyAdmin.upgradeAndCall.
*/

import { expect } from "chai";
import hre from "hardhat";
import { putAddress, readBook } from "./lib/addresses";
import { readVersion } from "./lib/call";
import { loadContract } from "./contracts";
import { buildUpgradeModule } from "./lib/ignition";

async function addressOf(value: {
  getAddress?: () => Promise<string>;
  target?: unknown;
}): Promise<string> {
  if (typeof value.getAddress === "function") return value.getAddress();
  return String(value.target);
}

async function upgradeDirect(
  id: string,
  proxyKey: string,
  adminKey: string,
  implName: string,
  expectedVersion: string,
  note?: string
): Promise<void> {
  const network = hre.network.name;
  const row = readBook(network)[id] ?? {};
  const proxyAddr = row[proxyKey];
  const proxyAdminAddr = row[adminKey];
  if (!proxyAddr || !proxyAdminAddr) {
    throw new Error(
      `Missing ${proxyKey} or ${adminKey} in deployments/${network}.json (${id})`
    );
  }

  const [account] = await hre.ethers.getSigners();
  console.log(`Signer:     ${account.address}`);
  console.log(`Proxy:      ${proxyAddr}`);
  console.log(`ProxyAdmin: ${proxyAdminAddr}`);

  const factory = await hre.ethers.getContractFactory(implName);
  const impl = await factory.deploy();
  await impl.waitForDeployment();
  const implAddr = await impl.getAddress();
  console.log(`New impl:   ${implAddr}`);

  const proxyAdmin = await hre.ethers.getContractAt("ProxyAdmin", proxyAdminAddr);
  const upgradeTx = await proxyAdmin.connect(account).upgradeAndCall(proxyAddr, implAddr, "0x");
  console.log(`upgradeAndCall tx: ${upgradeTx.hash}`);
  await upgradeTx.wait();

  const version = await readVersion(hre, implName, proxyAddr);
  expect(version).to.equal(expectedVersion);
  console.log(`Proxy version: ${version}`);

  putAddress(network, id, implName, implAddr);
  if (note) console.log(note);
}

async function main() {
  const network = hre.network.name;
  const { id, spec, net } = loadContract(network);
  console.log(`Upgrade ${id} on ${network} via ${net.upgrade}`);

  if (net.upgrade === "direct") {
    await upgradeDirect(
      id,
      spec.proxyKey,
      spec.adminKey,
      net.upgradeImpl,
      net.upgradeVersion,
      net.upgradeNote
    );
    return;
  }

  const deployed = await hre.ignition.deploy(
    buildUpgradeModule(
      network,
      net.upgradeImpl,
      net.upgradeFrom ?? net.deployImpl,
      net.upgradeContractAt ?? net.upgradeImpl
    )
  );
  const proxyAddress = await addressOf(deployed.contractInstance);
  console.log(proxyAddress);
  const version = await readVersion(hre, net.upgradeImpl, proxyAddress);
  expect(version).to.equal(net.upgradeVersion);
  console.log(`Proxy version: ${version}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
