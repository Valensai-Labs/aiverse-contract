import { expect } from "chai";
import hre from "hardhat";
import { checkInManagerModule } from "../../proxy-module/base-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: checkInManager } = await hre.ignition.deploy(
    checkInManagerModule
  );
  console.log(checkInManager.target);
  const checkInManagerTyped = await hre.ethers.getContractAt(
    "CheckInManagerV1_0_5",
    checkInManager.target
  );
  expect(await checkInManagerTyped.connect(otherAccount).version()).to.equal(
    "1.0.5"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
