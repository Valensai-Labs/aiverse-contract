import "dotenv/config";
import { ethers } from "ethers";
import type { HardhatRuntimeEnvironment } from "hardhat/types";
import type { Signer } from "ethers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface VanityContext {
  deployer: Signer;
  deployerAddress: string;
  funderAddress: string;
}

/** Fund the vanity deployer, bump its nonce, then wait before the deploy transaction. */
export async function prepareVanityDeployer(
  hre: HardhatRuntimeEnvironment
): Promise<VanityContext> {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("DEPLOYER_PRIVATE_KEY is not set in the .env file.");
  }
  const targetNonceStr = process.env.TARGET_DEPLOYMENT_NONCE;
  if (!targetNonceStr) {
    throw new Error("TARGET_DEPLOYMENT_NONCE is not set in the .env file.");
  }
  const targetNonce = parseInt(targetNonceStr, 10) - 1;
  if (!process.env.MNEMONICS) {
    throw new Error("MNEMONICS is not set in the .env file.");
  }

  const provider = hre.ethers.provider;
  const funderWallet = ethers.HDNodeWallet.fromMnemonic(
    ethers.Mnemonic.fromPhrase(process.env.MNEMONICS)
  ).connect(provider);
  const funderAddress = await funderWallet.getAddress();
  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  console.log(`Funder address:   ${funderAddress}`);
  console.log(`Deployer address: ${deployerAddress}`);

  const minBalance = ethers.parseEther("0.000025");
  const amountToSend = ethers.parseEther("0.000025");
  const deployerBalance = await provider.getBalance(deployerAddress);
  if (deployerBalance < minBalance) {
    console.log("Deployer balance is below minimum. Funding...");
    const tx = await funderWallet.sendTransaction({
      to: deployerAddress,
      value: amountToSend,
    });
    console.log(`Sending ${ethers.formatEther(amountToSend)} ETH... TX hash: ${tx.hash}`);
    await tx.wait();
    console.log("Funding transaction confirmed.");
  }
  console.log(
    `Deployer balance is sufficient: ${ethers.formatEther(
      await provider.getBalance(deployerAddress)
    )} ETH.`
  );

  let currentNonce = await provider.getTransactionCount(deployerAddress, "latest");
  console.log(`Current nonce: ${currentNonce}`);
  if (currentNonce > targetNonce) {
    throw new Error(`Current nonce (${currentNonce}) > target nonce (${targetNonce}).`);
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
      const nonceAfter = await provider.getTransactionCount(deployerAddress, "latest");
      if (nonceAfter === nonceBefore + 1) {
        console.log(`Nonce updated on-chain to ${nonceAfter}.`);
        currentNonce = nonceAfter;
        break;
      }
      console.log(`Nonce still ${nonceAfter}, waiting 3s...`);
      await sleep(3000);
    }
  }

  console.log(`Nonce reached target of ${targetNonce}.`);
  await sleep(15000);
  return { deployer, deployerAddress, funderAddress };
}

export async function transferProxyAdmin(
  hre: HardhatRuntimeEnvironment,
  proxyAdminAddress: string,
  deployer: Signer,
  funderAddress: string
): Promise<void> {
  console.log("Transferring ProxyAdmin ownership to funder...");
  const typedProxyAdmin = await hre.ethers.getContractAt(
    "ProxyAdmin",
    proxyAdminAddress,
    deployer
  );
  const currentOwner = await typedProxyAdmin.owner();
  console.log(`Current ProxyAdmin owner: ${currentOwner}`);
  console.log(`New intended ProxyAdmin owner:     ${funderAddress}`);

  if (currentOwner.toLowerCase() === funderAddress.toLowerCase()) {
    console.log("ProxyAdmin ownership is already held by the funder address.");
    return;
  }

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
      return;
    }
    console.log(`Owner still ${newOwner}, waiting 3 seconds before re-checking...`);
    await sleep(3000);
  }
}
