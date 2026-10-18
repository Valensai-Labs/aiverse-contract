# aiverse-contract

Upgradeable Solidity contracts for the Aiverse protocol, plus the Hardhat scripts that deploy, upgrade, and verify them.

Solidity `0.8.28`, optimizer runs `200`. Proxies are OpenZeppelin transparent proxies. Each contract lives in a version folder such as `contracts/V1.0.6/`. Tests cover the latest version of each contract.

`contracts/Lock.sol` is the stock Hardhat sample and is not part of the protocol.

## Contracts

| `CONTRACT` id | Latest source | Role |
| --- | --- | --- |
| `account-registrar` | `V1.0.9` | Email-hash registration |
| `activity-manager` | `V1.0.1` | Activity AIHASH claims |
| `aiverse-coin` | `V1.0.6` | AICOIN |
| `aiverse-fund` | `V1.0.4` | Fund seats and vesting |
| `aiverse-topup` | `V1.0.2` | USDC settlement (EIP-2612 and EIP-3009) |
| `aiverse-treasury` | `V1.0.2` | AICOIN custody |
| `batch-transfer` | `V1` | Batch `transferFrom` |
| `check-in-manager` | `V1.0.7` | Weekly check-in |
| `emergency-migrator` | `V1` | Account migration |
| `node-manager` | `V1.0.4` | Nodes and node signers |
| `power-asset` | `V1.0.10` | AIHASH |
| `stake-controller` | `V1.0.13` | Power staking and daily rewards |

`base` and `base-sepolia` have config for every contract. `sepolia` has config for `account-registrar`, `aiverse-coin`, `check-in-manager`, `node-manager`, `power-asset`, and `stake-controller`.

Recorded proxy, admin, and implementation addresses are in `scripts/deployments/<network>.json`.

## Setup

```shell
pnpm install
cp .example.env .env
```

| Variable | Used for |
| --- | --- |
| `MNEMONICS` | Sepolia accounts, vanity funder, and Ownable owner transfer. HD index 0. |
| `DEPLOYER_PRIVATE_KEY` | Signer on `base` and `base-sepolia` when `DEPLOY_OR_UPGRADE=deploy`. |
| `UPGRADER_PRIVATE_KEY` | Signer on `base` and `base-sepolia` otherwise. Must own `ProxyAdmin` for upgrades. |
| `DEPLOY_OR_UPGRADE` | `deploy` or `upgrade`. Selects which key Hardhat loads on Base networks. |
| `TARGET_DEPLOYMENT_NONCE` | Vanity deploys. The deploy transaction uses this nonce. |
| `ETHERSCAN_API_KEY` | Explorer verification. `BASESCAN_API_KEY` is the fallback. |

`hardhat.config.ts` sends HTTP traffic through `http://127.0.0.1:7890`. That local proxy has to be up before RPC or verify calls.

## Tests

`paths.tests` in the Hardhat config is `./tests`, and that directory does not exist. Pass the `test/` path explicitly. `pnpm test` is a stub and does not run the suite.

```shell
pnpm exec hardhat test test/aiverse-coin.test.ts
pnpm exec hardhat test test/*.test.ts
```

## Scripts

Every script reads `CONTRACT` and `--network` (`base`, `base-sepolia`, or `sepolia`). Per-contract behavior is the table in `scripts/contracts.ts`.

```shell
# Deploy. On Base networks set DEPLOY_OR_UPGRADE=deploy.
CONTRACT=aiverse-coin pnpm exec hardhat run scripts/deploy.ts --network base

# Upgrade. On Base networks set DEPLOY_OR_UPGRADE=upgrade.
CONTRACT=aiverse-coin pnpm exec hardhat run scripts/upgrade.ts --network base

# Verify the implementation, ProxyAdmin, and proxy from the address book.
CONTRACT=aiverse-coin pnpm exec hardhat run scripts/verify.ts --network base

# Storage layout check before an upgrade.
CONTRACT=aiverse-treasury pnpm exec hardhat run scripts/validate-upgrade.ts --network base

# Move Ownable owner from the vanity deployer to the mnemonic account.
# activity-manager on base, emergency-migrator on base and base-sepolia.
CONTRACT=emergency-migrator pnpm exec hardhat run scripts/transfer-owner.ts --network base
```

Vanity deploys (the Base deploys that set `vanity` in `scripts/contracts.ts`, plus `emergency-migrator` on `base-sepolia`) fund the deployer, bump its nonce to `TARGET_DEPLOYMENT_NONCE - 1`, deploy, then transfer `ProxyAdmin` to mnemonic index 0.

Ignition deploys and upgrades replay the existing journal. Module ids are derived in `scripts/lib/ignition-ids.ts`. Do not rename an id that has already been deployed: a new id deploys a new proxy. Direct upgrades call `ProxyAdmin.upgradeAndCall` and do not go through Ignition. Those paths are the ones already used for ActivityManager, AiverseTopUp on `base`, AiverseTreasury, and EmergencyMigrator.

Atomic deploys need these addresses in the environment:

| Contract | Variables |
| --- | --- |
| `activity-manager` | `ACTIVITY_NODE_MANAGER`, `ACTIVITY_POWER_ASSET` |
| `aiverse-topup` | `TOPUP_USDC`, `TOPUP_TREASURY`, `TOPUP_INITIAL_PLATFORM`. `TOPUP_INITIAL_OWNER` is optional and defaults to the funder. |
| `aiverse-treasury` | `TREASURY_AICOIN`. `TREASURY_INITIAL_OWNER` is optional and defaults to the funder. |
| `emergency-migrator` | `EMERGENCY_ACCOUNT_REGISTRAR`, `EMERGENCY_STAKE_CONTROLLER`, `EMERGENCY_POWER_ASSET`, `EMERGENCY_AIVERSE_COIN`, `EMERGENCY_MIGRATION_SIGNER` |

`validate-upgrade.ts` compares the first deployed implementation with the configured upgrade target. Override either side with `OLD_CONTRACT` and `NEW_CONTRACT`. `PROXY_KIND` defaults to `transparent`.
