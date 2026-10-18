import { run } from "hardhat";

/** Verify one address on the explorer; treat "already verified" as success. */
export async function verifyOne(
  label: string,
  address: string,
  constructorArguments: unknown[] = []
): Promise<void> {
  try {
    await run("verify:verify", { address, constructorArguments });
    console.log(`✅ ${label} verified.`);
  } catch (error: unknown) {
    const msg = String(error instanceof Error ? error.message : error).toLowerCase();
    if (msg.includes("already verified")) {
      console.log(`✅ ${label} already verified.`);
      return;
    }
    throw error;
  }
}

/** Typical transparent proxy trio: implementation + ProxyAdmin + proxy. */
export async function verifyTransparentProxyStack(params: {
  implementationLabel: string;
  implementationAddr: string;
  proxyAddr: string;
  proxyAdminAddr: string;
  proxyAdminOwner: string;
}): Promise<void> {
  const {
    implementationLabel,
    implementationAddr,
    proxyAddr,
    proxyAdminAddr,
    proxyAdminOwner,
  } = params;

  await verifyOne(implementationLabel, implementationAddr, []);
  await verifyOne("ProxyAdmin", proxyAdminAddr, [proxyAdminOwner]);
  await verifyOne("TransparentUpgradeableProxy", proxyAddr, [
    implementationAddr,
    proxyAdminOwner,
    "0x",
  ]);
}
