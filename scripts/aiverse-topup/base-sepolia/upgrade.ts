/*
npx hardhat run scripts/aiverse-topup/base-sepolia/upgrade.ts --network base-sepolia
*/

import { expect } from "chai";
import hre from "hardhat";
import { aiverseTopUpUpgradeModule } from "../../upgrade-module/base-sepolia";

async function main() {
  const [account] = await hre.ethers.getSigners();
  const { contractInstance: aiverseTopUpUpgrade } = await hre.ignition.deploy(
    aiverseTopUpUpgradeModule
  );
  console.log(aiverseTopUpUpgrade.target);
  const aiverseTopUpTyped = await hre.ethers.getContractAt(
    "AiverseTopUpV1_0_2",
    aiverseTopUpUpgrade.target
  );
  expect(await aiverseTopUpTyped.connect(account).version()).to.equal("1.0.2");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
