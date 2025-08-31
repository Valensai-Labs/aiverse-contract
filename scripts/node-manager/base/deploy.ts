import { expect } from "chai";
import "dotenv/config";
import { ethers } from "ethers";
import hre from "hardhat";
import { nodeManagerModule } from "../../proxy-module/base";

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

  const [deployer, upgrader] = await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  console.log(`Funder address:   ${funderAddress}`);
  console.log(`Deployer address: ${deployerAddress}`);
  console.log(`Upgrader address:    ${await upgrader.getAddress()}`);

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  // ========================================================================================
  // 2. Fund Deployer Wallet if Necessary
  // ========================================================================================
  const minBalance = ethers.parseEther("0.00001");
  const amountToSend = ethers.parseEther("0.00001");
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

  const { contractInstance: nodeManager } = await hre.ignition.deploy(
    nodeManagerModule
  );
  console.log(nodeManager.target);
  const nodeManagerTyped = await hre.ethers.getContractAt(
    "NodeManagerV1_0_2",
    nodeManager.target
  );
  expect(await nodeManagerTyped.connect(deployer).version()).to.equal("1.0.2");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
