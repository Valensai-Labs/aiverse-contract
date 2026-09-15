/*
npx hardhat run scripts/emergency-migrator/base-sepolia/deploy.ts --network base-sepolia

Env:
  EMERGENCY_ACCOUNT_REGISTRAR
  EMERGENCY_STAKE_CONTROLLER
  EMERGENCY_POWER_ASSET
  EMERGENCY_AIVERSE_COIN
  EMERGENCY_MIGRATION_SIGNER
*/

import { expect } from "chai";
import "dotenv/config";
import hre from "hardhat";
import {
  deployTransparentProxyWithInit,
  requireAddressEnv,
} from "../../deploy-utils/atomicProxyDeploy";

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const deployerAddress = await deployer.getAddress();

  const accountRegistrar = requireAddressEnv("EMERGENCY_ACCOUNT_REGISTRAR");
  const stakeController = requireAddressEnv("EMERGENCY_STAKE_CONTROLLER");
  const powerAsset = requireAddressEnv("EMERGENCY_POWER_ASSET");
  const aiverseCoin = requireAddressEnv("EMERGENCY_AIVERSE_COIN");
  const migrationSigner = requireAddressEnv("EMERGENCY_MIGRATION_SIGNER");

  console.log(`Deployer:          ${deployerAddress}`);
  console.log(`AccountRegistrar:  ${accountRegistrar}`);
  console.log(`StakeController:   ${stakeController}`);
  console.log(`PowerAsset:        ${powerAsset}`);
  console.log(`AiverseCoin:       ${aiverseCoin}`);
  console.log(`MigrationSigner:   ${migrationSigner}`);

  const { proxyAddress, implementationAddress, proxyAdminAddress } =
    await deployTransparentProxyWithInit(
      hre,
      deployer,
      "EmergencyMigrator",
      [
        accountRegistrar,
        stakeController,
        powerAsset,
        aiverseCoin,
        migrationSigner,
      ],
      deployerAddress
    );

  console.log(`Proxy:          ${proxyAddress}`);
  console.log(`Implementation: ${implementationAddress}`);
  console.log(`ProxyAdmin:     ${proxyAdminAddress}`);
  console.log(
    "Update scripts/emergency-migrator/base-sepolia/deployedAddr.json with the addresses above."
  );

  const emergencyMigrator = await hre.ethers.getContractAt(
    "EmergencyMigrator",
    proxyAddress
  );
  expect(await emergencyMigrator.version()).to.equal("1.0.0");
  expect(await emergencyMigrator.owner()).to.equal(deployerAddress);
  expect(await emergencyMigrator.accountRegistrar()).to.equal(accountRegistrar);
  expect(await emergencyMigrator.stakeController()).to.equal(stakeController);
  expect(await emergencyMigrator.powerAsset()).to.equal(powerAsset);
  expect(await emergencyMigrator.aiverseCoin()).to.equal(aiverseCoin);
  expect(await emergencyMigrator.migrationSigner()).to.equal(migrationSigner);
  expect(await emergencyMigrator.configEpoch()).to.equal(0n);
  console.log("Version and initialization verification successful!");
  console.log(
    "Post-deploy: setRelayer(relayer, true); then patch EmergencyMigrator proxy address into StakeController / PowerAsset / AiverseCoin emergency hooks before upgrading those contracts."
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
