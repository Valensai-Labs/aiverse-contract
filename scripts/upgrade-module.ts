import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { buildProxyModule } from "./proxy-module";

export function buildUpgradeModule(contractName: string, version: string) {
  return buildModule(`${contractName + version}_Upgrade_ProxyModule`, (m) => {
    const proxyAdminOwner = m.getAccount(0);
    const { proxyAdmin, proxy } = m.useModule(buildProxyModule(contractName));
    const implV2 = m.contract(contractName + version);
    m.call(proxyAdmin, "upgradeAndCall", [proxy, implV2, "0x"], {
      from: proxyAdminOwner,
    });
    return { proxyAdmin, proxy };
  });
}

function buildUpgradeContractModule(
  contractName: string,
  version: string,
  proxyModule: ReturnType<typeof buildModule>
) {
  return buildModule(`${contractName + version}_Upgrade_Module`, (m) => {
    const { proxy, proxyAdmin } = m.useModule(proxyModule);
    const contractInstance = m.contractAt(contractName + version, proxy);
    return {
      contractInstance,
      proxy,
      proxyAdmin,
    };
  });
}

export const powerAssetUpgradeModule = buildUpgradeContractModule(
  "PowerAsset",
  "V1_0_2",
  buildUpgradeModule("PowerAsset", "V1_0_2")
);

export const nodeManagerUpgradeModule = buildUpgradeContractModule(
  "NodeManager",
  "V1_0_1",
  buildUpgradeModule("NodeManager", "V1_0_1")
);

export const aiverseCoinUpgradeModule = buildUpgradeContractModule(
  "AiverseCoin",
  "V1_0_1",
  buildUpgradeModule("AiverseCoin", "V1_0_1")
);

export const accountRegistrarUpgradeModule = buildUpgradeContractModule(
  "AccountRegistrar",
  "V1_0_1",
  buildUpgradeModule("AccountRegistrar", "V1_0_1")
);

export const checkInManagerUpgradeModule = buildUpgradeContractModule(
  "CheckInManager",
  "V1_0_2",
  buildUpgradeModule("CheckInManager", "V1_0_2")
);

export const stakeControllerUpgradeModule = buildUpgradeContractModule(
  "StakeController",
  "V1_0_5",
  buildUpgradeModule("StakeController", "V1_0_5")
);
