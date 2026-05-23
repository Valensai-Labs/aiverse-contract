/*
npx hardhat run scripts/aiverse-treasury/base-sepolia/upgrade.ts --network base-sepolia
*/

import { expect } from "chai";
import hre from "hardhat";
import { aiverseTreasuryUpgradeModule } from "../../upgrade-module/base-sepolia";

async function main() {
  const [, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: aiverseTreasuryUpgrade } = await hre.ignition.deploy(
    aiverseTreasuryUpgradeModule
  );
  console.log(aiverseTreasuryUpgrade.target);
  const aiverseTreasuryTyped = await hre.ethers.getContractAt(
    "AiverseTreasuryV1_0_1",
    aiverseTreasuryUpgrade.target
  );
  expect(await aiverseTreasuryTyped.connect(otherAccount).version()).to.equal(
    "1.0.1"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
