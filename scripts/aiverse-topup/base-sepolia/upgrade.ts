/*
npx hardhat run scripts/aiverse-topup/base-sepolia/upgrade.ts --network base-sepolia
*/

import { expect } from "chai";
import hre from "hardhat";
import { aiverseTopUpUpgradeModule } from "../../upgrade-module/base-sepolia";

async function main() {
  const [, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: aiverseTopUpUpgrade } = await hre.ignition.deploy(
    aiverseTopUpUpgradeModule
  );
  console.log(aiverseTopUpUpgrade.target);
  const aiverseTopUpTyped = await hre.ethers.getContractAt(
    "AiverseTopUp",
    aiverseTopUpUpgrade.target
  );
  expect(await aiverseTopUpTyped.connect(otherAccount).version()).to.equal(
    "1.0.0"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
