import { expect } from "chai";
import hre from "hardhat";
import { readCall } from "./lib/call";
import { optionalAddressEnv, requireAddressEnv } from "./lib/env";

export interface InitContext {
  deployerAddress: string;
  funderAddress: string;
}

export interface NetworkSpec {
  deploy: "ignition" | "atomic";
  /** Fund the vanity key, bump nonce, then transfer ProxyAdmin to the mnemonic account. */
  vanity?: boolean;
  deployImpl: string;
  deployVersion: string;
  /** ABI used to read version() after deploy. Defaults to deployImpl. */
  deployReadAs?: string;
  upgrade: "ignition" | "direct";
  upgradeImpl: string;
  upgradeVersion: string;
  /**
   * Ignition journal name of the first implementation.
   * Defaults to deployImpl. Do not change a value that has already been deployed.
   */
  upgradeFrom?: string;
  /**
   * Name used in the upgrade module id and its contractAt.
   * BatchTransfer's module says BatchTransferV1_0_0 while the artifact is BatchTransfer.
   */
  upgradeContractAt?: string;
  verifyImpl: string;
  /** Sepolia scripts verified the implementation and proxy only. */
  verifyAdmin?: boolean;
  init?: (ctx: InitContext) => unknown[];
  checkInit?: (proxy: string, ctx: InitContext) => Promise<void>;
  postDeployNote?: string;
  upgradeNote?: string;
}

export interface TransferOwnerSpec {
  networks: string[];
  contractName: string;
  envProxy: string;
}

export interface ContractSpec {
  proxyKey: string;
  adminKey: string;
  transferOwner?: TransferOwnerSpec;
  networks: Record<string, NetworkSpec>;
}

function ignition(
  spec: Omit<NetworkSpec, "deploy" | "upgrade" | "verifyAdmin"> & {
    upgrade?: NetworkSpec["upgrade"];
    verifyAdmin?: boolean;
  }
): NetworkSpec {
  return {
    ...spec,
    deploy: "ignition",
    upgrade: spec.upgrade ?? "ignition",
    verifyAdmin: spec.verifyAdmin ?? true,
  };
}

const ACTIVITY_NOTE =
  "Post-deploy: setFoundationSigner, setMaxMint, setMinClaim; then PowerAsset.setActivityClaimManager(proxy).";

function activityInit(_ctx: InitContext): unknown[] {
  return [
    requireAddressEnv("ACTIVITY_NODE_MANAGER"),
    requireAddressEnv("ACTIVITY_POWER_ASSET"),
  ];
}

async function checkActivity(proxy: string, ctx: InitContext): Promise<void> {
  const nodeManager = requireAddressEnv("ACTIVITY_NODE_MANAGER");
  const powerAsset = requireAddressEnv("ACTIVITY_POWER_ASSET");
  expect(await readCall(hre, "ActivityManager", proxy, "owner")).to.equal(
    ctx.deployerAddress
  );
  expect(await readCall(hre, "ActivityManager", proxy, "nodeManager")).to.equal(nodeManager);
  expect(await readCall(hre, "ActivityManager", proxy, "powerAsset")).to.equal(powerAsset);
}

function topUpInit(ctx: InitContext): unknown[] {
  return [
    optionalAddressEnv("TOPUP_INITIAL_OWNER", ctx.funderAddress),
    requireAddressEnv("TOPUP_USDC"),
    requireAddressEnv("TOPUP_TREASURY"),
    requireAddressEnv("TOPUP_INITIAL_PLATFORM"),
  ];
}

async function checkTopUp(proxy: string, ctx: InitContext): Promise<void> {
  const owner = optionalAddressEnv("TOPUP_INITIAL_OWNER", ctx.funderAddress);
  const usdc = requireAddressEnv("TOPUP_USDC");
  const treasury = requireAddressEnv("TOPUP_TREASURY");
  const platform = requireAddressEnv("TOPUP_INITIAL_PLATFORM");
  expect(await readCall(hre, "AiverseTopUp", proxy, "owner")).to.equal(owner);
  expect(await readCall(hre, "AiverseTopUp", proxy, "treasury")).to.equal(treasury);
  expect(await readCall(hre, "AiverseTopUp", proxy, "usdc")).to.equal(usdc);
  expect(await readCall(hre, "AiverseTopUp", proxy, "isPlatform", [platform])).to.equal(
    true
  );
}

function treasuryInit(ctx: InitContext): unknown[] {
  return [
    optionalAddressEnv("TREASURY_INITIAL_OWNER", ctx.funderAddress),
    requireAddressEnv("TREASURY_AICOIN"),
  ];
}

async function checkTreasury(proxy: string, ctx: InitContext): Promise<void> {
  const owner = optionalAddressEnv("TREASURY_INITIAL_OWNER", ctx.funderAddress);
  const aicoin = requireAddressEnv("TREASURY_AICOIN");
  expect(await readCall(hre, "AiverseTreasuryV1_0_1", proxy, "owner")).to.equal(owner);
  expect(await readCall(hre, "AiverseTreasuryV1_0_1", proxy, "aicoin")).to.equal(aicoin);
}

function emergencyInit(_ctx: InitContext): unknown[] {
  return [
    requireAddressEnv("EMERGENCY_ACCOUNT_REGISTRAR"),
    requireAddressEnv("EMERGENCY_STAKE_CONTROLLER"),
    requireAddressEnv("EMERGENCY_POWER_ASSET"),
    requireAddressEnv("EMERGENCY_AIVERSE_COIN"),
    requireAddressEnv("EMERGENCY_MIGRATION_SIGNER"),
  ];
}

async function checkEmergency(proxy: string, ctx: InitContext): Promise<void> {
  const [registrar, stake, power, coin, signer] = emergencyInit(ctx);
  expect(await readCall(hre, "EmergencyMigrator", proxy, "owner")).to.equal(
    ctx.deployerAddress
  );
  expect(await readCall(hre, "EmergencyMigrator", proxy, "accountRegistrar")).to.equal(
    registrar
  );
  expect(await readCall(hre, "EmergencyMigrator", proxy, "stakeController")).to.equal(stake);
  expect(await readCall(hre, "EmergencyMigrator", proxy, "powerAsset")).to.equal(power);
  expect(await readCall(hre, "EmergencyMigrator", proxy, "aiverseCoin")).to.equal(coin);
  expect(await readCall(hre, "EmergencyMigrator", proxy, "migrationSigner")).to.equal(signer);
  expect(await readCall(hre, "EmergencyMigrator", proxy, "configEpoch")).to.equal(0n);
}

export const CONTRACTS: Record<string, ContractSpec> = {
  "account-registrar": {
    proxyKey: "AccountRegistrarProxy",
    adminKey: "AccountRegistrarProxyAdmin",
    networks: {
      base: ignition({
        vanity: true,
        deployImpl: "AccountRegistrarV1_0_5",
        deployVersion: "1.0.5",
        upgradeImpl: "AccountRegistrarV1_0_9",
        upgradeVersion: "1.0.9",
        verifyImpl: "AccountRegistrarV1_0_9",
      }),
      "base-sepolia": ignition({
        deployImpl: "AccountRegistrarV1_0_2",
        deployVersion: "1.0.2",
        upgradeImpl: "AccountRegistrarV1_0_9",
        upgradeVersion: "1.0.9",
        verifyImpl: "AccountRegistrarV1_0_9",
      }),
      sepolia: ignition({
        deployImpl: "AccountRegistrar",
        deployVersion: "1.0.0",
        upgradeImpl: "AccountRegistrarV1_0_2",
        upgradeVersion: "1.0.2",
        verifyImpl: "AccountRegistrarV1_0_1",
        verifyAdmin: false,
      }),
    },
  },
  "activity-manager": {
    proxyKey: "ActivityManagerProxy",
    adminKey: "ActivityManagerProxyAdmin",
    transferOwner: {
      networks: ["base"],
      contractName: "ActivityManager",
      envProxy: "ACTIVITY_MANAGER_PROXY",
    },
    networks: {
      base: {
        deploy: "atomic",
        vanity: true,
        deployImpl: "ActivityManager",
        deployVersion: "1.0.0",
        upgrade: "direct",
        upgradeImpl: "ActivityManagerV1_0_1",
        upgradeVersion: "1.0.1",
        verifyImpl: "ActivityManagerV1_0_1",
        init: activityInit,
        checkInit: checkActivity,
        postDeployNote: ACTIVITY_NOTE,
      },
      "base-sepolia": {
        deploy: "atomic",
        deployImpl: "ActivityManager",
        deployVersion: "1.0.0",
        upgrade: "direct",
        upgradeImpl: "ActivityManagerV1_0_1",
        upgradeVersion: "1.0.1",
        verifyImpl: "ActivityManagerV1_0_1",
        init: activityInit,
        checkInit: checkActivity,
        postDeployNote: ACTIVITY_NOTE,
      },
    },
  },
  "aiverse-coin": {
    proxyKey: "AiverseCoinProxy",
    adminKey: "AiverseCoinProxyAdmin",
    networks: {
      base: ignition({
        vanity: true,
        deployImpl: "AiverseCoinV1_0_4",
        deployVersion: "1.0.4",
        upgradeImpl: "AiverseCoinV1_0_6",
        upgradeVersion: "1.0.6",
        verifyImpl: "AiverseCoinV1_0_6",
      }),
      "base-sepolia": ignition({
        deployImpl: "AiverseCoinV1_0_4",
        deployVersion: "1.0.4",
        upgradeImpl: "AiverseCoinV1_0_6",
        upgradeVersion: "1.0.6",
        verifyImpl: "AiverseCoinV1_0_6",
      }),
      sepolia: ignition({
        deployImpl: "AiverseCoin",
        deployVersion: "1.0.0",
        upgradeImpl: "AiverseCoinV1_0_2",
        upgradeVersion: "1.0.2",
        verifyImpl: "AiverseCoinV1_0_1",
        verifyAdmin: false,
      }),
    },
  },
  "aiverse-fund": {
    proxyKey: "AiverseFundProxy",
    adminKey: "AiverseFundProxyAdmin",
    networks: {
      base: ignition({
        vanity: true,
        deployImpl: "AiverseFundV1_0_2",
        deployVersion: "1.0.2",
        upgradeImpl: "AiverseFundV1_0_4",
        upgradeVersion: "1.0.4",
        verifyImpl: "AiverseFundV1_0_4",
      }),
      "base-sepolia": ignition({
        deployImpl: "AiverseFundV1_0_2",
        deployVersion: "1.0.2",
        upgradeImpl: "AiverseFundV1_0_4",
        upgradeVersion: "1.0.4",
        verifyImpl: "AiverseFundV1_0_4",
      }),
    },
  },
  "aiverse-topup": {
    proxyKey: "AiverseTopUpProxy",
    adminKey: "AiverseTopUpProxyAdmin",
    networks: {
      base: {
        deploy: "atomic",
        vanity: true,
        deployImpl: "AiverseTopUp",
        deployVersion: "1.0.0",
        upgrade: "direct",
        upgradeImpl: "AiverseTopUpV1_0_2",
        upgradeVersion: "1.0.2",
        verifyImpl: "AiverseTopUpV1_0_2",
        init: topUpInit,
        checkInit: checkTopUp,
        upgradeNote:
          "Post-upgrade: no initialize. 1.0.1 powerAsset / maxGiftAmount keep working.",
      },
      "base-sepolia": ignition({
        deployImpl: "AiverseTopUp",
        deployVersion: "1.0.0",
        upgradeImpl: "AiverseTopUpV1_0_2",
        upgradeVersion: "1.0.2",
        verifyImpl: "AiverseTopUpV1_0_2",
      }),
    },
  },
  "aiverse-treasury": {
    proxyKey: "AiverseTreasuryProxy",
    adminKey: "AiverseTreasuryProxyAdmin",
    networks: {
      base: {
        deploy: "atomic",
        vanity: true,
        deployImpl: "AiverseTreasuryV1_0_1",
        deployVersion: "1.0.1",
        upgrade: "direct",
        upgradeImpl: "AiverseTreasuryV1_0_2",
        upgradeVersion: "1.0.2",
        verifyImpl: "AiverseTreasuryV1_0_2",
        init: treasuryInit,
        checkInit: checkTreasury,
      },
      "base-sepolia": ignition({
        deployImpl: "AiverseTreasuryV1_0_1",
        deployVersion: "1.0.1",
        upgrade: "direct",
        upgradeImpl: "AiverseTreasuryV1_0_2",
        upgradeVersion: "1.0.2",
        verifyImpl: "AiverseTreasuryV1_0_2",
      }),
    },
  },
  "batch-transfer": {
    proxyKey: "BatchTransferProxy",
    adminKey: "BatchTransferProxyAdmin",
    networks: {
      base: ignition({
        vanity: true,
        deployImpl: "BatchTransfer",
        deployVersion: "1.0.0",
        upgradeImpl: "BatchTransfer",
        upgradeVersion: "1.0.0",
        upgradeContractAt: "BatchTransferV1_0_0",
        verifyImpl: "BatchTransfer",
      }),
      "base-sepolia": ignition({
        deployImpl: "BatchTransfer",
        deployVersion: "1.0.0",
        upgradeImpl: "BatchTransfer",
        upgradeVersion: "1.0.0",
        upgradeContractAt: "BatchTransferV1_0_0",
        verifyImpl: "BatchTransfer",
      }),
    },
  },
  "check-in-manager": {
    proxyKey: "CheckInManagerProxy",
    adminKey: "CheckInManagerProxyAdmin",
    networks: {
      base: ignition({
        vanity: true,
        deployImpl: "CheckInManagerV1_0_5",
        deployVersion: "1.0.5",
        upgradeImpl: "CheckInManagerV1_0_7",
        upgradeVersion: "1.0.7",
        verifyImpl: "CheckInManagerV1_0_7",
      }),
      "base-sepolia": ignition({
        deployImpl: "CheckInManagerV1_0_5",
        deployVersion: "1.0.5",
        upgradeImpl: "CheckInManagerV1_0_7",
        upgradeVersion: "1.0.7",
        verifyImpl: "CheckInManagerV1_0_7",
      }),
      sepolia: ignition({
        deployImpl: "CheckInManager",
        deployVersion: "1.0.0",
        upgradeImpl: "CheckInManagerV1_0_3",
        upgradeVersion: "1.0.3",
        verifyImpl: "CheckInManagerV1_0_2",
        verifyAdmin: false,
      }),
    },
  },
  "emergency-migrator": {
    proxyKey: "EmergencyMigratorProxy",
    adminKey: "EmergencyMigratorProxyAdmin",
    transferOwner: {
      networks: ["base", "base-sepolia"],
      contractName: "EmergencyMigrator",
      envProxy: "EMERGENCY_MIGRATOR_PROXY",
    },
    networks: {
      base: {
        deploy: "atomic",
        vanity: true,
        deployImpl: "EmergencyMigrator",
        deployVersion: "1.0.0",
        upgrade: "direct",
        upgradeImpl: "EmergencyMigrator",
        upgradeVersion: "1.0.0",
        verifyImpl: "EmergencyMigrator",
        init: emergencyInit,
        checkInit: checkEmergency,
      },
      "base-sepolia": {
        deploy: "atomic",
        vanity: true,
        deployImpl: "EmergencyMigrator",
        deployVersion: "1.0.0",
        upgrade: "direct",
        upgradeImpl: "EmergencyMigrator",
        upgradeVersion: "1.0.0",
        verifyImpl: "EmergencyMigrator",
        init: emergencyInit,
        checkInit: checkEmergency,
      },
    },
  },
  "node-manager": {
    proxyKey: "NodeManagerProxy",
    adminKey: "NodeManagerProxyAdmin",
    networks: {
      base: ignition({
        vanity: true,
        deployImpl: "NodeManagerV1_0_3",
        deployVersion: "1.0.3",
        upgradeImpl: "NodeManagerV1_0_4",
        upgradeVersion: "1.0.4",
        verifyImpl: "NodeManagerV1_0_4",
      }),
      "base-sepolia": ignition({
        deployImpl: "NodeManagerV1_0_2",
        deployVersion: "1.0.2",
        upgradeImpl: "NodeManagerV1_0_4",
        upgradeVersion: "1.0.4",
        verifyImpl: "NodeManagerV1_0_4",
      }),
      sepolia: ignition({
        deployImpl: "NodeManager",
        deployVersion: "1.0.0",
        upgradeImpl: "NodeManagerV1_0_2",
        upgradeVersion: "1.0.2",
        verifyImpl: "NodeManagerV1_0_1",
        verifyAdmin: false,
      }),
    },
  },
  "power-asset": {
    proxyKey: "PowerAssetProxy",
    adminKey: "PowerAssetProxyAdmin",
    networks: {
      base: ignition({
        vanity: true,
        deployImpl: "PowerAssetV1_0_4",
        deployVersion: "1.0.4",
        upgradeImpl: "PowerAssetV1_0_10",
        upgradeVersion: "1.0.10",
        verifyImpl: "PowerAssetV1_0_10",
      }),
      "base-sepolia": ignition({
        deployImpl: "PowerAssetV1_0_3",
        deployVersion: "1.0.3",
        upgradeImpl: "PowerAssetV1_0_10",
        upgradeVersion: "1.0.10",
        verifyImpl: "PowerAssetV1_0_10",
      }),
      sepolia: ignition({
        deployImpl: "PowerAsset",
        deployVersion: "1.0.0",
        upgradeImpl: "PowerAssetV1_0_3",
        upgradeVersion: "1.0.3",
        verifyImpl: "PowerAssetV1_0_2",
        verifyAdmin: false,
      }),
    },
  },
  "stake-controller": {
    proxyKey: "StakeControllerProxy",
    adminKey: "StakeControllerProxyAdmin",
    networks: {
      base: ignition({
        vanity: true,
        deployImpl: "StakeControllerV1_0_10",
        deployVersion: "1.0.10",
        upgradeImpl: "StakeControllerV1_0_13",
        upgradeVersion: "1.0.13",
        verifyImpl: "StakeControllerV1_0_13",
      }),
      "base-sepolia": ignition({
        // The Ignition journal deploys V1_0_10. The old script then reads version()
        // through the V1_0_11 ABI and expects 1.0.11.
        deployImpl: "StakeControllerV1_0_10",
        deployVersion: "1.0.11",
        deployReadAs: "StakeControllerV1_0_11",
        upgradeImpl: "StakeControllerV1_0_13",
        upgradeVersion: "1.0.13",
        verifyImpl: "StakeControllerV1_0_13",
      }),
      sepolia: ignition({
        deployImpl: "StakeController",
        deployVersion: "1.0.0",
        upgradeImpl: "StakeControllerV1_0_6",
        upgradeVersion: "1.0.6",
        verifyImpl: "StakeControllerV1_0_5",
        verifyAdmin: false,
      }),
    },
  },
};

export function loadContract(network: string): {
  id: string;
  spec: ContractSpec;
  net: NetworkSpec;
} {
  const id = process.env.CONTRACT;
  const known = Object.keys(CONTRACTS).join(", ");
  if (!id || !CONTRACTS[id]) {
    throw new Error(`Set CONTRACT to one of: ${known}`);
  }
  const spec = CONTRACTS[id];
  const net = spec.networks[network];
  if (!net) {
    throw new Error(`${id} has no script config for network ${network}`);
  }
  return { id, spec, net };
}
