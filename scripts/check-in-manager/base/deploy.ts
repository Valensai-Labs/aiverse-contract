/*
npx hardhat run scripts/check-in-manager/base/deploy.ts --network base
*/

import { expect } from "chai";
import "dotenv/config";
import { ethers } from "ethers";
import hre from "hardhat";
import { checkInManagerModule } from "../../proxy-module/base";

async function main() {
  // ========================================================================================
  // 1. Configuration & Wallet Setup
  // ========================================================================================
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set in the .env file.");
  }

  const targetNonceStr = process.env.TARGET_DEPLOYMENT_NONCE;
  if (!targetNonceStr) {
    throw new Error("TARGET_DEPLOYMENT_NONCE is not set in the .env file.");
  }
  const targetNonce = parseInt(targetNonceStr, 10) - 1;

  const provider = hre.ethers.provider;
  const funderWallet = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(process.env.MNEMONICS!)
  ).connect(provider);
  const funderAddress = await funderWallet.getAddress();

  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  console.log(`Funder address:   ${funderAddress}`);
  console.log(`Deployer address: ${deployerAddress}`);

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  // ========================================================================================
  // 2. Fund Deployer Wallet if Necessary
  // ========================================================================================
  const minBalance = ethers.parseEther("0.000025");
  const amountToSend = ethers.parseEther("0.000025");
  let deployerBalance = await provider.getBalance(deployerAddress);

  if (deployerBalance < minBalance) {
    console.log(`Deployer balance is below minimum. Funding...`);
    const tx = await funderWallet.sendTransaction({
      to: deployerAddress,
      value: amountToSend,
    });
    console.log(
      `Sending ${ethers.formatEther(amountToSend)} ETH... TX hash: ${tx.hash}`
    );
    await tx.wait();
    console.log("Funding transaction confirmed.");
  }
  console.log(
    `Deployer balance is sufficient: ${ethers.formatEther(
      await provider.getBalance(deployerAddress)
    )} ETH.`
  );

  // ========================================================================================
  // 3. Increment Nonce to Target
  // ========================================================================================
  let currentNonce = await provider.getTransactionCount(
    deployerAddress,
    "latest"
  );
  console.log(`Current nonce: ${currentNonce}`);

  if (currentNonce > targetNonce) {
    throw new Error(
      `Current nonce (${currentNonce}) > target nonce (${targetNonce}).`
    );
  }

  while (currentNonce < targetNonce) {
    const nonceBefore = currentNonce;
    console.log(
      `Nonce is ${nonceBefore}, target is ${targetNonce}. Sending tx to increment...`
    );
    const tx = await deployer.sendTransaction({
      to: deployerAddress,
      value: 0,
      nonce: nonceBefore,
    });
    await tx.wait();
    console.log(`Tx sent: ${tx.hash}. Waiting for on-chain nonce update...`);

    while (true) {
      const nonceAfter = await provider.getTransactionCount(
        deployerAddress,
        "latest"
      );
      if (nonceAfter === nonceBefore + 1) {
        console.log(`Nonce updated on-chain to ${nonceAfter}.`);
        currentNonce = nonceAfter;
        break;
      }
      console.log(`Nonce still ${nonceAfter}, waiting 3s...`);
      await sleep(3000);
    }
  }

  // ========================================================================================
  // 4. Deploy Upgradeable Proxy Contract & Verify
  // ========================================================================================
  console.log(`Nonce reached target of ${targetNonce}. Deploying contract...`);
  await sleep(15000);

  const { contractInstance: checkInManager, proxyAdmin } =
    await hre.ignition.deploy(checkInManagerModule);
  console.log(checkInManager.target);
  const checkInManagerTyped = await hre.ethers.getContractAt(
    "CheckInManagerV1_0_5",
    checkInManager.target
  );
  expect(await checkInManagerTyped.connect(deployer).version()).to.equal("1.0.5");
  console.log("Version verification successful!");

  // ========================================================================================
  // 5. Transfer ProxyAdmin Ownership
  // ========================================================================================
  console.log("Transferring ProxyAdmin ownership to funder...");

  // Get a properly typed instance of the ProxyAdmin contract
  const proxyAdminAddress = await proxyAdmin.getAddress();
  const typedProxyAdmin = await hre.ethers.getContractAt(
    "ProxyAdmin",
    proxyAdminAddress,
    deployer
  );

  const currentOwner = await typedProxyAdmin.owner();
  console.log(`Current ProxyAdmin owner: ${currentOwner}`);
  console.log(`New intended ProxyAdmin owner:     ${funderAddress}`);

  if (currentOwner.toLowerCase() !== funderAddress.toLowerCase()) {
    const tx = await typedProxyAdmin.transferOwnership(funderAddress);
    console.log(`Ownership transfer transaction sent with hash: ${tx.hash}`);
    await tx.wait();
    console.log(
      "Ownership transfer transaction confirmed. Waiting for on-chain state to update..."
    );

    while (true) {
      const newOwner = await typedProxyAdmin.owner();
      if (newOwner.toLowerCase() === funderAddress.toLowerCase()) {
        console.log(`Ownership successfully updated on-chain to ${newOwner}.`);
        break;
      }
      console.log(
        `Owner still ${newOwner}, waiting 3 seconds before re-checking...`
      );
      await sleep(3000);
    }
  } else {
    console.log("ProxyAdmin ownership is already held by the funder address.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
