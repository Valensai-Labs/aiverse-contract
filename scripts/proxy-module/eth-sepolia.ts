import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export function buildProxyModule(contractName: string) {
  return buildModule(`${contractName}_ProxyModule`, (m) => {
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
  return buildModule(`${contractName}_Module`, (m) => {
    const { proxy, proxyAdmin } = m.useModule(proxyModule);
    const contractInstance = m.contractAt(contractName, proxy);
    return {
      contractInstance,
      proxy,
      proxyAdmin,
    };
  });
}

const powerAssetProxyModule = buildProxyModule("PowerAsset");
export const powerAssetModule = buildProxiedContractModule(
  "PowerAsset",
  powerAssetProxyModule
);

const nodeManagerProxyModule = buildProxyModule("NodeManager");
export const nodeManagerModule = buildProxiedContractModule(
  "NodeManager",
  nodeManagerProxyModule
);

const aiverseCoinProxyModule = buildProxyModule("AiverseCoin");
export const aiverseCoinModule = buildProxiedContractModule(
  "AiverseCoin",
  aiverseCoinProxyModule
);

const accountRegistrarProxyModule = buildProxyModule("AccountRegistrar");
export const accountRegistrarModule = buildProxiedContractModule(
  "AccountRegistrar",
  accountRegistrarProxyModule
);

const checkInManagerProxyModule = buildProxyModule("CheckInManager");
export const checkInManagerModule = buildProxiedContractModule(
  "CheckInManager",
  checkInManagerProxyModule
);

const stakeControllerProxyModule = buildProxyModule("StakeController");
export const stakeControllerModule = buildProxiedContractModule(
  "StakeController",
  stakeControllerProxyModule
);
