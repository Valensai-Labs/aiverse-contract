import { expect } from "chai";
import hre from "hardhat";
import { checkInManagerUpgradeModule } from "../upgrade-module";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: checkInManagerUpgrade } = await hre.ignition.deploy(
    checkInManagerUpgradeModule
  );
  console.log(checkInManagerUpgrade.target);
  const checkInManagerTyped = await hre.ethers.getContractAt(
    "CheckInManagerV1_0_1",
    checkInManagerUpgrade.target
  );
  expect(await checkInManagerTyped.connect(otherAccount).version()).to.equal(
    "1.0.1"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
