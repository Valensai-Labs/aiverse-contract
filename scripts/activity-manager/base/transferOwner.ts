/*
Transfer ActivityManager Ownable from vanity deployer → funder (MNEMONICS index 0).
Does not touch ProxyAdmin (already transferred at deploy).

DEPLOY_OR_UPGRADE=deploy npx hardhat run scripts/activity-manager/base/transferOwner.ts --network base

Env:
  DEPLOY_OR_UPGRADE=deploy   # hardhat base network uses DEPLOYER_PRIVATE_KEY
  DEPLOYER_PRIVATE_KEY       # must be current ActivityManager.owner()
  MNEMONICS                  # new owner = HD index 0
  ACTIVITY_MANAGER_PROXY     # optional override; else deployedAddr.json
*/

import { expect } from "chai";
import "dotenv/config";
import * as fs from "fs";
import { ethers } from "ethers";
import hre from "hardhat";
import * as path from "path";

async function main() {
  const addressPath = path.join(__dirname, "./deployedAddr.json");
  if (!fs.existsSync(addressPath)) {
    throw new Error("deployedAddr.json not found in the same directory.");
  }
  const addresses = JSON.parse(fs.readFileSync(addressPath, "utf8"));

  const proxyFromEnv = process.env.ACTIVITY_MANAGER_PROXY;
  const proxyAddress = ethers.getAddress(
    proxyFromEnv && proxyFromEnv.length > 0
      ? proxyFromEnv
      : addresses.base.ActivityManagerProxy
  );
  if (!proxyAddress || proxyAddress === ethers.ZeroAddress) {
    throw new Error(
      "ActivityManager proxy address missing. Set ACTIVITY_MANAGER_PROXY or update deployedAddr.json."
    );
  }

  if (!process.env.MNEMONICS) {
    throw new Error("MNEMONICS is not set in the .env file.");
  }

  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const funderAddress = await ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(process.env.MNEMONICS)
  ).getAddress();

  console.log(`Proxy:              ${proxyAddress}`);
  console.log(`Current signer:     ${deployerAddress}`);
  console.log(`New owner (funder): ${funderAddress}`);

  const activityManager = await hre.ethers.getContractAt(
    "ActivityManager",
    proxyAddress,
    deployer
  );

  const currentOwner = await activityManager.owner();
  console.log(`Current owner:      ${currentOwner}`);

  if (currentOwner.toLowerCase() !== deployerAddress.toLowerCase()) {
    throw new Error(
      `Signer ${deployerAddress} is not ActivityManager.owner() (${currentOwner}). ` +
        `Run with DEPLOY_OR_UPGRADE=deploy so DEPLOYER_PRIVATE_KEY is used.`
    );
  }

  if (currentOwner.toLowerCase() === funderAddress.toLowerCase()) {
    console.log("Owner is already the funder. Nothing to do.");
    return;
  }

  const tx = await activityManager.transferOwnership(funderAddress);
  console.log(`transferOwnership tx: ${tx.hash}`);
  await tx.wait();

  const newOwner = await activityManager.owner();
  expect(newOwner.toLowerCase()).to.equal(funderAddress.toLowerCase());
  console.log(`Owner updated on-chain to ${newOwner}.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
