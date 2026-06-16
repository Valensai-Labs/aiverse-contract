import type { HardhatRuntimeEnvironment } from "hardhat/types";
import { getAddress, ZeroAddress } from "ethers";
import type { ContractFactory, Signer } from "ethers";

const ERC1967_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";
const PROXY_ADMIN_SYNC_DELAY_MS = 15_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set in the .env file.`);
  }
  return value;
}

export function requireAddressEnv(name: string): string {
  return getAddress(requireEnv(name));
}

export function optionalAddressEnv(
  name: string,
  fallback: string
): string {
  const value = process.env[name];
  return getAddress(value && value.length > 0 ? value : fallback);
}

async function getProxyAdminAddress(
  hre: HardhatRuntimeEnvironment,
  proxyAddress: string
): Promise<string> {
  await sleep(PROXY_ADMIN_SYNC_DELAY_MS);

  const slot = await hre.ethers.provider.getStorage(
    proxyAddress,
    ERC1967_ADMIN_SLOT
  );
  const proxyAdmin = getAddress(`0x${slot.slice(-40)}`);
  if (proxyAdmin === ZeroAddress) {
    throw new Error(`ProxyAdmin not found for proxy ${proxyAddress}`);
  }
  return proxyAdmin;
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
