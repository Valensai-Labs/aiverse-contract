/*
npx hardhat run scripts/stake-controller/base/upgrade.ts --network base
*/

import { expect } from "chai";
import hre from "hardhat";
import { stakeControllerUpgradeModule } from "../../upgrade-module/base";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: stakeControllerUpgrade } =
    await hre.ignition.deploy(stakeControllerUpgradeModule);
  console.log(stakeControllerUpgrade.target);
  const stakeControllerTyped = await hre.ethers.getContractAt(
    "StakeControllerV1_0_11",
    stakeControllerUpgrade.target
  );
  expect(await stakeControllerTyped.connect(account).version()).to.equal(
    "1.0.11"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
