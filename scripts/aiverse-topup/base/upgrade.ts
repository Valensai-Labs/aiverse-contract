/*
npx hardhat run scripts/aiverse-topup/base/upgrade.ts --network base
*/

import { expect } from "chai";
import hre from "hardhat";
import { aiverseTopUpUpgradeModule } from "../../upgrade-module/base";

async function main() {
  const [account] = await hre.ethers.getSigners();
  const { contractInstance: aiverseTopUpUpgrade } = await hre.ignition.deploy(
    aiverseTopUpUpgradeModule
  );
  console.log(aiverseTopUpUpgrade.target);
  const aiverseTopUpTyped = await hre.ethers.getContractAt(
    "AiverseTopUp",
    aiverseTopUpUpgrade.target
  );
  expect(await aiverseTopUpTyped.connect(account).version()).to.equal("1.0.0");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
