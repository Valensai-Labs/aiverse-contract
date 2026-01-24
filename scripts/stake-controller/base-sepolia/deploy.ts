import { expect } from "chai";
import hre from "hardhat";
import { stakeControllerModule } from "../../proxy-module/base-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: stakeController } = await hre.ignition.deploy(
    stakeControllerModule
  );
  console.log(stakeController.target);
  const stakeControllerTyped = await hre.ethers.getContractAt(
    "StakeControllerV1_0_11",
    stakeController.target
  );
  expect(await stakeControllerTyped.connect(otherAccount).version()).to.equal(
    "1.0.11"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
