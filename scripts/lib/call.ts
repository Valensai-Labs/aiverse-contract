import type { HardhatRuntimeEnvironment } from "hardhat/types";

export async function readCall(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  address: string,
  fn: string,
  args: unknown[] = []
): Promise<unknown> {
  const contract = await hre.ethers.getContractAt(contractName, address);
  return contract.getFunction(fn).staticCall(...(args as never[]));
}

export async function readVersion(
  hre: HardhatRuntimeEnvironment,
  contractName: string,
  address: string
): Promise<string> {
  return String(await readCall(hre, contractName, address, "version"));
}
