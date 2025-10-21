import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import hre from "hardhat";
import { buildProxyModule } from "../proxy-module/base-sepolia";

export function buildUpgradeModule(
  newImplementationName: string,
  deployedImplementationName: string
) {
  const chain = hre.network.name.replace("-", "_");
  return buildModule(
    `${chain}_${newImplementationName}_Upgrade_ProxyModule`,
    (m) => {
      const proxyAdminOwner = m.getAccount(0);

      // Reconstruct the IDENTICAL module definition from the initial deployment
      // to find the correct proxy in Ignition's journal.
      const originalProxyModule = buildProxyModule(deployedImplementationName);

      const { proxy, proxyAdmin } = m.useModule(originalProxyModule);

      const implV2 = m.contract(newImplementationName);

      m.call(proxyAdmin, "upgradeAndCall", [proxy, implV2, "0x"], {
        from: proxyAdminOwner,
      });

      return { proxyAdmin, proxy };
    }
  );
}

function buildUpgradeContractModule(
  contractName: string,
  newVersion: string,
  proxyModule: ReturnType<typeof buildModule>
) {
  const chain = hre.network.name.replace("-", "_");
  const newImplementationName = contractName + newVersion;
  return buildModule(
    `${chain}_${newImplementationName}_Upgrade_Module`,
    (m) => {
      const { proxy, proxyAdmin } = m.useModule(proxyModule);
      const contractInstance = m.contractAt(newImplementationName, proxy);
      return {
        contractInstance,
        proxy,
        proxyAdmin,
      };
    }
  );
}

// Upgrade TO this new version... FROM the old version
export const powerAssetUpgradeModule = buildUpgradeContractModule(
  "PowerAsset",
  "V1_0_6",
  buildUpgradeModule("PowerAssetV1_0_6", "PowerAssetV1_0_3")
);

export const nodeManagerUpgradeModule = buildUpgradeContractModule(
  "NodeManager",
  "V1_0_3",
  buildUpgradeModule("NodeManagerV1_0_3", "NodeManagerV1_0_2")
);

export const aiverseCoinUpgradeModule = buildUpgradeContractModule(
  "AiverseCoin",
  "V1_0_4",
  buildUpgradeModule("AiverseCoinV1_0_4", "AiverseCoinV1_0_4")
);

export const accountRegistrarUpgradeModule = buildUpgradeContractModule(
  "AccountRegistrar",
  "V1_0_5",
  buildUpgradeModule("AccountRegistrarV1_0_5", "AccountRegistrarV1_0_2")
);

export const checkInManagerUpgradeModule = buildUpgradeContractModule(
  "CheckInManager",
  "V1_0_5",
  buildUpgradeModule("CheckInManagerV1_0_5", "CheckInManagerV1_0_5")
);

export const stakeControllerUpgradeModule = buildUpgradeContractModule(
  "StakeController",
  "V1_0_10",
  buildUpgradeModule("StakeControllerV1_0_10", "StakeControllerV1_0_10")
);
