/*
npx hardhat run scripts/check-in-manager/base/upgrade.ts --network base
*/

import { expect } from "chai";
import hre from "hardhat";
import { checkInManagerUpgradeModule } from "../../upgrade-module/base";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: checkInManagerUpgrade } = await hre.ignition.deploy(
    checkInManagerUpgradeModule
  );
  console.log(checkInManagerUpgrade.target);
  const checkInManagerTyped = await hre.ethers.getContractAt(
    "CheckInManagerV1_0_5",
    checkInManagerUpgrade.target
  );
  expect(await checkInManagerTyped.connect(account).version()).to.equal(
    "1.0.5"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
