/*
npx hardhat run scripts/stake-controller/eth-sepolia/upgrade.ts --network sepolia
*/

import { expect } from "chai";
import hre from "hardhat";
import { stakeControllerUpgradeModule } from "../../upgrade-module/eth-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: stakeControllerUpgrade } =
    await hre.ignition.deploy(stakeControllerUpgradeModule);
  console.log(stakeControllerUpgrade.target);
  const stakeControllerTyped = await hre.ethers.getContractAt(
    "StakeControllerV1_0_6",
    stakeControllerUpgrade.target
  );
  expect(await stakeControllerTyped.connect(otherAccount).version()).to.equal(
    "1.0.6"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
