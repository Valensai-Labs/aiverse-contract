/*
Check storage layout before an upgrade.

CONTRACT=aiverse-treasury npx hardhat run scripts/validate-upgrade.ts --network base

Optional overrides:
  OLD_CONTRACT   artifact name registered with forceImport
  NEW_CONTRACT   artifact name to validate
  PROXY_KIND     transparent (default) or uups
*/

import hre from "hardhat";
import { readBook } from "./lib/addresses";
import { loadContract } from "./contracts";

async function main() {
  const network = hre.network.name;
  const { id, spec, net } = loadContract(network);
  const proxyAddress = readBook(network)[id]?.[spec.proxyKey];
  if (!proxyAddress) {
    throw new Error(`Missing ${spec.proxyKey} in deployments/${network}.json (${id})`);
  }

  const oldContractName = process.env.OLD_CONTRACT ?? net.upgradeFrom ?? net.deployImpl;
  const newContractName = process.env.NEW_CONTRACT ?? net.upgradeImpl;
  const proxyKind = (process.env.PROXY_KIND ?? "transparent") as "transparent" | "uups";
  const oldImplementation = readBook(network)[id]?.[oldContractName];

  console.log(`\nValidating upgrade of ${id} on ${network}`);
  console.log(`Proxy:          ${proxyAddress}`);
  console.log(`Old contract:   ${oldContractName}`);
  if (oldImplementation) console.log(`Old impl:       ${oldImplementation}`);
  console.log(`New contract:   ${newContractName}`);
  console.log(`Proxy kind:     ${proxyKind}`);

  const oldContract = await hre.ethers.getContractFactory(oldContractName);
  const newContract = await hre.ethers.getContractFactory(newContractName);

  console.log("\nRegistering old implementation...");
  await hre.upgrades.forceImport(proxyAddress, oldContract, { kind: proxyKind });

  console.log("\nChecking storage layout compatibility...");
  await hre.upgrades.validateUpgrade(proxyAddress, newContract, { kind: proxyKind });

  console.log("\nStorage layout validation passed.");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
