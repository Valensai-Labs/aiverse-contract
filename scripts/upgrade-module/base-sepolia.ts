import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import hre from "hardhat";
import { buildProxyModule } from "../proxy-module/base-sepolia";

export function buildUpgradeModule(contractName: string, version: string) {
  const chain = hre.network.name;
  return buildModule(
    `${chain}_${contractName + version}_Upgrade_ProxyModule`,
    (m) => {
      const proxyAdminOwner = m.getAccount(0);
      const { proxyAdmin, proxy } = m.useModule(buildProxyModule(contractName));
      const implV2 = m.contract(contractName + version);
      m.call(proxyAdmin, "upgradeAndCall", [proxy, implV2, "0x"], {
        from: proxyAdminOwner,
      });
      return { proxyAdmin, proxy };
    }
  );
}

function buildUpgradeContractModule(
  contractName: string,
  version: string,
  proxyModule: ReturnType<typeof buildModule>
) {
  const chain = hre.network.name;
  return buildModule(
    `${chain}_${contractName + version}_Upgrade_Module`,
    (m) => {
      const { proxy, proxyAdmin } = m.useModule(proxyModule);
      const contractInstance = m.contractAt(contractName + version, proxy);
      return {
        contractInstance,
        proxy,
        proxyAdmin,
      };
    }
  );
}

export const powerAssetUpgradeModule = buildUpgradeContractModule(
  "PowerAsset",
  "V1_0_3",
  buildUpgradeModule("PowerAsset", "V1_0_3")
);

export const nodeManagerUpgradeModule = buildUpgradeContractModule(
  "NodeManager",
  "V1_0_2",
  buildUpgradeModule("NodeManager", "V1_0_2")
);

export const aiverseCoinUpgradeModule = buildUpgradeContractModule(
  "AiverseCoin",
  "V1_0_2",
  buildUpgradeModule("AiverseCoin", "V1_0_2")
);

export const accountRegistrarUpgradeModule = buildUpgradeContractModule(
  "AccountRegistrar",
  "V1_0_2",
  buildUpgradeModule("AccountRegistrar", "V1_0_2")
);

export const checkInManagerUpgradeModule = buildUpgradeContractModule(
  "CheckInManager",
  "V1_0_3",
  buildUpgradeModule("CheckInManager", "V1_0_3")
);

export const stakeControllerUpgradeModule = buildUpgradeContractModule(
  "StakeController",
  "V1_0_6",
  buildUpgradeModule("StakeController", "V1_0_6")
);
