import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { getAddress, ZeroAddress } from "ethers";
import type { ContractFactory, Signer } from "ethers";

const ERC1967_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const ERC1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
const PROXY_ADMIN_SYNC_DELAY_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function addressFromSlot(slot: string): string {
  return getAddress(`0x${slot.slice(-40)}`);
}

async function getProxyAdminAddress(
  hre: HardhatRuntimeEnvironment,
  proxyAddress: string
): Promise<string> {
  await sleep(PROXY_ADMIN_SYNC_DELAY_MS);

  const slot = await hre.ethers.provider.getStorage(proxyAddress, ERC1967_ADMIN_SLOT);
  const proxyAdmin = addressFromSlot(slot);
  if (proxyAdmin === ZeroAddress) {
    throw new Error(`ProxyAdmin not found for proxy ${proxyAddress}`);
  }
  return proxyAdmin;
}

export async function readImplementationAddress(
  hre: HardhatRuntimeEnvironment,
  proxyAddress: string
): Promise<string> {
  const slot = await hre.ethers.provider.getStorage(
    proxyAddress,
    ERC1967_IMPLEMENTATION_SLOT
  );
  const implementation = addressFromSlot(slot);
  if (implementation === ZeroAddress) {
    throw new Error(`Implementation not found for proxy ${proxyAddress}`);
  }
  return implementation;
}

export async function deployTransparentProxyWithInit(
  hre: HardhatRuntimeEnvironment,
  deployer: Signer,
  implementationName: string,
  initializeArgs: unknown[],
  proxyAdminOwner: string
): Promise<{
  proxyAddress: string;
  implementationAddress: string;
  proxyAdminAddress: string;
}> {
  const implementationFactory: ContractFactory = await hre.ethers.getContractFactory(
    implementationName,
    deployer
  );
  const implementation = await implementationFactory.deploy();
  await implementation.waitForDeployment();
  const implementationAddress = await implementation.getAddress();

  const initData = implementationFactory.interface.encodeFunctionData(
    "initialize",
    initializeArgs
  );

  const proxyFactory = await hre.ethers.getContractFactory(
    "TransparentUpgradeableProxy",
    deployer
  );
  const proxy = await proxyFactory.deploy(
    implementationAddress,
    proxyAdminOwner,
    initData
  );
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();
  const proxyAdminAddress = await getProxyAdminAddress(hre, proxyAddress);

  return {
    proxyAddress,
    implementationAddress,
    proxyAdminAddress,
  };
}
