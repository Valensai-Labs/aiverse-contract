import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import {
  proxiedModuleId,
  proxyModuleId,
  upgradeContractModuleId,
  upgradeProxyModuleId,
} from "./ignition-ids";

export function buildProxyModule(networkName: string, contractName: string) {
  return buildModule(proxyModuleId(networkName, contractName), (m) => {
    const proxyAdminOwner = m.getAccount(0);
    const impl = m.contract(contractName);
    const proxy = m.contract("TransparentUpgradeableProxy", [
      impl,
      proxyAdminOwner,
      "0x",
    ]);
    const proxyAdminAddress = m.readEventArgument(proxy, "AdminChanged", "newAdmin");
    const proxyAdmin = m.contractAt("ProxyAdmin", proxyAdminAddress);
    return { proxy, proxyAdmin };
  });
}

export function buildDeployModule(networkName: string, contractName: string) {
  const proxyModule = buildProxyModule(networkName, contractName);
  return buildModule(proxiedModuleId(networkName, contractName), (m) => {
    const { proxy, proxyAdmin } = m.useModule(proxyModule);
    const contractInstance = m.contractAt(contractName, proxy);
    return { contractInstance, proxy, proxyAdmin };
  });
}

export function buildUpgradeModule(
  networkName: string,
  upgradeImpl: string,
  upgradeFrom: string,
  upgradeContractAt: string
) {
  const upgradeProxyModule = buildModule(
    upgradeProxyModuleId(networkName, upgradeImpl),
    (m) => {
      const proxyAdminOwner = m.getAccount(0);
      const originalProxyModule = buildProxyModule(networkName, upgradeFrom);
      const { proxy, proxyAdmin } = m.useModule(originalProxyModule);
      const implV2 = m.contract(upgradeImpl);
      m.call(proxyAdmin, "upgradeAndCall", [proxy, implV2, "0x"], {
        from: proxyAdminOwner,
      });
      return { proxyAdmin, proxy };
    }
  );

  return buildModule(upgradeContractModuleId(networkName, upgradeContractAt), (m) => {
    const { proxy, proxyAdmin } = m.useModule(upgradeProxyModule);
    const contractInstance = m.contractAt(upgradeContractAt, proxy);
    return { contractInstance, proxy, proxyAdmin };
  });
}
