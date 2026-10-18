/*
CONTRACT=aiverse-coin npx hardhat run scripts/verify.ts --network base

Reads deployments/<network>.json. The signer address is used as the
TransparentUpgradeableProxy admin argument, matching the old verify scripts.
*/

import hre from "hardhat";
import { readBook } from "./lib/addresses";
import { verifyOne, verifyTransparentProxyStack } from "./lib/verify-proxy";
import { loadContract } from "./contracts";

function requireKey(row: Record<string, string>, key: string, network: string): string {
  const value = row[key];
  if (!value) {
    throw new Error(`Missing ${key} in deployments/${network}.json`);
  }
  return value;
}

async function main() {
  const network = hre.network.name;
  const { id, spec, net } = loadContract(network);
  const row = readBook(network)[id] ?? {};
  const implementationAddr = requireKey(row, net.verifyImpl, network);
  const proxyAddr = requireKey(row, spec.proxyKey, network);
  const [deployer] = await hre.ethers.getSigners();

  console.log(`Verifying ${id} on ${network}...`);
  console.log(`${net.verifyImpl}: ${implementationAddr}`);
  console.log(`${spec.proxyKey}: ${proxyAddr}`);

  if (net.verifyAdmin === false) {
    await verifyOne(`${net.verifyImpl} implementation`, implementationAddr, []);
    await verifyOne("TransparentUpgradeableProxy", proxyAddr, [
      implementationAddr,
      deployer.address,
      "0x",
    ]);
  } else {
    const proxyAdminAddr = requireKey(row, spec.adminKey, network);
    console.log(`${spec.adminKey}: ${proxyAdminAddr}`);
    await verifyTransparentProxyStack({
      implementationLabel: `${net.verifyImpl} implementation`,
      implementationAddr,
      proxyAddr,
      proxyAdminAddr,
      proxyAdminOwner: deployer.address,
    });
  }

  console.log(`\n${id} verified.`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
