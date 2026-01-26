/*
npx hardhat run scripts/aiverse-fund/base/upgrade.ts --network base
*/

import { expect } from "chai";
import hre from "hardhat";
import { aiverseFundUpgradeModule } from "../../upgrade-module/base";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: aiverseFundUpgrade } = await hre.ignition.deploy(
    aiverseFundUpgradeModule
  );
  console.log(aiverseFundUpgrade.target);
  const aiverseFundTyped = await hre.ethers.getContractAt(
    "AiverseFundV1_0_2",
    aiverseFundUpgrade.target
  );
  expect(await aiverseFundTyped.connect(account).version()).to.equal(
    "1.0.2"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

