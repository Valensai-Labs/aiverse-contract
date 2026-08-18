/*
npx hardhat run scripts/check-in-manager/base-sepolia/upgrade.ts --network base-sepolia
*/

import { expect } from "chai";
import hre from "hardhat";
import { checkInManagerUpgradeModule } from "../../upgrade-module/base-sepolia";

async function main() {
  const [, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: checkInManagerUpgrade } = await hre.ignition.deploy(
    checkInManagerUpgradeModule
  );
  console.log(checkInManagerUpgrade.target);
  const checkInManagerTyped = await hre.ethers.getContractAt(
    "CheckInManagerV1_0_7",
    checkInManagerUpgrade.target
  );
  expect(await checkInManagerTyped.connect(otherAccount).version()).to.equal(
    "1.0.7"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
