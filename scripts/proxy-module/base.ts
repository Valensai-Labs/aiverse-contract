import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import hre from "hardhat";

export function buildProxyModule(contractName: string) {
  const chain = hre.network.name.replace("-", "_");
  return buildModule(`${chain}_${contractName}_ProxyModule`, (m) => {
    const proxyAdminOwner = m.getAccount(0);
    const impl = m.contract(contractName);
    const proxy = m.contract("TransparentUpgradeableProxy", [
      impl,
      proxyAdminOwner,
      "0x",
    ]);
    const proxyAdminAddress = m.readEventArgument(
      proxy,
      "AdminChanged",
      "newAdmin"
    );
    const proxyAdmin = m.contractAt("ProxyAdmin", proxyAdminAddress);
    return { proxy, proxyAdmin };
  });
}

function buildProxiedContractModule(
  contractName: string,
  proxyModule: ReturnType<typeof buildModule>
) {
  const chain = hre.network.name.replace("-", "_");
  return buildModule(`${chain}_${contractName}_Module`, (m) => {
    const { proxy, proxyAdmin } = m.useModule(proxyModule);
    const contractInstance = m.contractAt(contractName, proxy);
    return {
      contractInstance,
      proxy,
      proxyAdmin,
    };
  });
}

const powerAssetProxyModule = buildProxyModule("PowerAssetV1_0_4");
export const powerAssetModule = buildProxiedContractModule(
  "PowerAssetV1_0_4",
  powerAssetProxyModule
);

const nodeManagerProxyModule = buildProxyModule("NodeManagerV1_0_3");
export const nodeManagerModule = buildProxiedContractModule(
  "NodeManagerV1_0_3",
  nodeManagerProxyModule
);

const aiverseCoinProxyModule = buildProxyModule("AiverseCoinV1_0_4");
export const aiverseCoinModule = buildProxiedContractModule(
  "AiverseCoinV1_0_4",
  aiverseCoinProxyModule
);

const accountRegistrarProxyModule = buildProxyModule("AccountRegistrarV1_0_5");
export const accountRegistrarModule = buildProxiedContractModule(
  "AccountRegistrarV1_0_5",
  accountRegistrarProxyModule
);

const checkInManagerProxyModule = buildProxyModule("CheckInManagerV1_0_5");
export const checkInManagerModule = buildProxiedContractModule(
  "CheckInManagerV1_0_5",
  checkInManagerProxyModule
);

const stakeControllerProxyModule = buildProxyModule("StakeControllerV1_0_10");
export const stakeControllerModule = buildProxiedContractModule(
  "StakeControllerV1_0_10",
  stakeControllerProxyModule
);

const aiverseFundProxyModule = buildProxyModule("AiverseFundV1_0_2");
export const aiverseFundModule = buildProxiedContractModule(
  "AiverseFundV1_0_2",
  aiverseFundProxyModule
);

const batchTransferProxyModule = buildProxyModule("BatchTransfer");
export const batchTransferModule = buildProxiedContractModule(
  "BatchTransfer",
  batchTransferProxyModule
);