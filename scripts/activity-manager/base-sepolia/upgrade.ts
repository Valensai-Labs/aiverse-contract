/*
npx hardhat run scripts/activity-manager/base-sepolia/upgrade.ts --network base-sepolia
*/

import { expect } from "chai";
import hre from "hardhat";
import { activityManagerUpgradeModule } from "../../upgrade-module/base-sepolia";

async function main() {
  const [, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: activityManagerUpgrade } = await hre.ignition.deploy(
    activityManagerUpgradeModule
  );
  console.log(activityManagerUpgrade.target);
  const activityManagerTyped = await hre.ethers.getContractAt(
    "ActivityManager",
    activityManagerUpgrade.target
  );
  expect(await activityManagerTyped.connect(otherAccount).version()).to.equal(
    "1.0.0"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
