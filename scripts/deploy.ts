/*
CONTRACT=aiverse-coin npx hardhat run scripts/deploy.ts --network base

Base and base-sepolia vanity deploys need DEPLOY_OR_UPGRADE=deploy so the
network account is DEPLOYER_PRIVATE_KEY. Vanity deploys also need
TARGET_DEPLOYMENT_NONCE and MNEMONICS.
*/

import { expect } from "chai";
import hre from "hardhat";
import { fillAddress } from "./lib/addresses";
import {
  deployTransparentProxyWithInit,
  readImplementationAddress,
} from "./lib/atomic-proxy";
import { readVersion } from "./lib/call";
import { loadContract } from "./contracts";
import { buildDeployModule } from "./lib/ignition";
import { prepareVanityDeployer, transferProxyAdmin } from "./lib/vanity";

async function addressOf(value: {
  getAddress?: () => Promise<string>;
  target?: unknown;
}): Promise<string> {
  if (typeof value.getAddress === "function") return value.getAddress();
  return String(value.target);
}

async function main() {
  const network = hre.network.name;
  const { id, spec, net } = loadContract(network);
  console.log(`Deploy ${id} on ${network} via ${net.deploy}`);

  const [defaultSigner] = await hre.ethers.getSigners();
  const vanity = net.vanity ? await prepareVanityDeployer(hre) : undefined;
  const deployer = vanity?.deployer ?? defaultSigner;
  const deployerAddress = vanity?.deployerAddress ?? (await defaultSigner.getAddress());
  const funderAddress = vanity?.funderAddress ?? deployerAddress;
  const ctx = { deployerAddress, funderAddress };

  let proxyAddress: string;
  let proxyAdminAddress: string;
  let implementationAddress: string;

  if (net.deploy === "atomic") {
    if (!net.init) throw new Error(`${id} is atomic but has no init args`);
    const deployed = await deployTransparentProxyWithInit(
      hre,
      deployer,
      net.deployImpl,
      net.init(ctx),
      deployerAddress
    );
    proxyAddress = deployed.proxyAddress;
    proxyAdminAddress = deployed.proxyAdminAddress;
    implementationAddress = deployed.implementationAddress;
  } else {
    const deployed = await hre.ignition.deploy(buildDeployModule(network, net.deployImpl));
    proxyAddress = await addressOf(deployed.contractInstance);
    proxyAdminAddress = await addressOf(deployed.proxyAdmin);
    implementationAddress = await readImplementationAddress(hre, proxyAddress);
  }

  console.log(`Proxy:          ${proxyAddress}`);
  console.log(`Implementation: ${implementationAddress}`);
  console.log(`ProxyAdmin:     ${proxyAdminAddress}`);

  const version = await readVersion(hre, net.deployReadAs ?? net.deployImpl, proxyAddress);
  expect(version).to.equal(net.deployVersion);
  if (net.checkInit) await net.checkInit(proxyAddress, ctx);
  console.log(`Version ${version} verified.`);
  if (net.postDeployNote) console.log(net.postDeployNote);

  if (vanity) {
    await transferProxyAdmin(hre, proxyAdminAddress, deployer, funderAddress);
  }

  fillAddress(network, id, spec.proxyKey, proxyAddress);
  fillAddress(network, id, spec.adminKey, proxyAdminAddress);
  fillAddress(network, id, net.deployImpl, implementationAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
