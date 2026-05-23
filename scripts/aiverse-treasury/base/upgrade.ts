/*
npx hardhat run scripts/aiverse-treasury/base/upgrade.ts --network base
*/

import { expect } from "chai";
import hre from "hardhat";
import { aiverseTreasuryUpgradeModule } from "../../upgrade-module/base";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: aiverseTreasuryUpgrade } = await hre.ignition.deploy(
    aiverseTreasuryUpgradeModule
  );
  console.log(aiverseTreasuryUpgrade.target);
  const aiverseTreasuryTyped = await hre.ethers.getContractAt(
    "AiverseTreasuryV1_0_1",
    aiverseTreasuryUpgrade.target
  );
  expect(await aiverseTreasuryTyped.connect(account).version()).to.equal(
    "1.0.1"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
