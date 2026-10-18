/*
Transfer the contract's Ownable owner from the vanity deployer to the mnemonic account.
Does not touch ProxyAdmin.

CONTRACT=emergency-migrator npx hardhat run scripts/transfer-owner.ts --network base

Env:
  DEPLOY_OR_UPGRADE=deploy   # base / base-sepolia signer is DEPLOYER_PRIVATE_KEY
  MNEMONICS                  # new owner is HD index 0
  <CONTRACT>_PROXY           # optional override of the proxy address
*/

import { expect } from "chai";
import "dotenv/config";
import { ethers } from "ethers";
import hre from "hardhat";
import { readBook } from "./lib/addresses";
import { requireEnv } from "./lib/env";
import { CONTRACTS, loadContract } from "./contracts";

async function main() {
  const network = hre.network.name;
  const { id, spec } = loadContract(network);
  const transfer = spec.transferOwner;
  if (!transfer || !transfer.networks.includes(network)) {
    const supported = Object.entries(CONTRACTS)
      .filter(([, item]) => item.transferOwner?.networks.includes(network))
      .map(([name]) => name);
    throw new Error(
      `${id} has no owner transfer on ${network}. On this network: ${
        supported.join(", ") || "none"
      }`
    );
  }

  const proxyFromEnv = process.env[transfer.envProxy];
  const recorded = readBook(network)[id]?.[spec.proxyKey];
  const proxyAddress = ethers.getAddress(
    proxyFromEnv && proxyFromEnv.length > 0 ? proxyFromEnv : recorded ?? ""
  );
  if (!proxyAddress || proxyAddress === ethers.ZeroAddress) {
    throw new Error(
      `${transfer.contractName} proxy address missing. Set ${transfer.envProxy} or deployments/${network}.json.`
    );
  }

  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const funderAddress = await ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(requireEnv("MNEMONICS"))
  ).getAddress();

  console.log(`Proxy:              ${proxyAddress}`);
  console.log(`Current signer:     ${deployerAddress}`);
  console.log(`New owner (funder): ${funderAddress}`);

  const contract = await hre.ethers.getContractAt(
    transfer.contractName,
    proxyAddress,
    deployer
  );
  const currentOwner = String(await contract.getFunction("owner").staticCall());
  console.log(`Current owner:      ${currentOwner}`);

  if (currentOwner.toLowerCase() !== deployerAddress.toLowerCase()) {
    throw new Error(
      `Signer ${deployerAddress} is not ${transfer.contractName}.owner() (${currentOwner}). ` +
        "Run with DEPLOY_OR_UPGRADE=deploy so DEPLOYER_PRIVATE_KEY is used."
    );
  }
  if (currentOwner.toLowerCase() === funderAddress.toLowerCase()) {
    console.log("Owner is already the funder. Nothing to do.");
    return;
  }

  const tx = await contract.getFunction("transferOwnership")(funderAddress);
  console.log(`transferOwnership tx: ${tx.hash}`);
  await tx.wait();

  const newOwner = String(await contract.getFunction("owner").staticCall());
  expect(newOwner.toLowerCase()).to.equal(funderAddress.toLowerCase());
  console.log(`Owner is now ${newOwner}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
