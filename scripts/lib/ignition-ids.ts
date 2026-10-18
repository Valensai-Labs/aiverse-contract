/** Ignition module ids. These strings are the deployment journal keys. */

export function chainPrefix(networkName: string): string {
  if (networkName === "sepolia") return "";
  return `${networkName.replace(/-/g, "_")}_`;
}

export function proxyModuleId(networkName: string, impl: string): string {
  return `${chainPrefix(networkName)}${impl}_ProxyModule`;
}

export function proxiedModuleId(networkName: string, impl: string): string {
  return `${chainPrefix(networkName)}${impl}_Module`;
}

export function upgradeProxyModuleId(networkName: string, impl: string): string {
  return `${chainPrefix(networkName)}${impl}_Upgrade_ProxyModule`;
}

export function upgradeContractModuleId(networkName: string, impl: string): string {
  return `${chainPrefix(networkName)}${impl}_Upgrade_Module`;
}
