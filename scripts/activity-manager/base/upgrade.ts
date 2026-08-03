/*
npx hardhat run scripts/activity-manager/base/upgrade.ts --network base

First release uses ActivityManager (1.0.0). When adding ActivityManagerV1_0_1,
update upgrade-module/base.ts and this script accordingly.
*/

import { expect } from "chai";
import hre from "hardhat";
import { activityManagerUpgradeModule } from "../../upgrade-module/base";

async function main() {
  const [account] = await hre.ethers.getSigners();
  const { contractInstance: activityManagerUpgrade } = await hre.ignition.deploy(
    activityManagerUpgradeModule
  );
  console.log(activityManagerUpgrade.target);
  const activityManagerTyped = await hre.ethers.getContractAt(
    "ActivityManager",
    activityManagerUpgrade.target
  );
  expect(await activityManagerTyped.connect(account).version()).to.equal(
    "1.0.0"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
