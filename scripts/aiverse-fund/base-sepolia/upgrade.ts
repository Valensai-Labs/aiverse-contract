import { expect } from "chai";
import hre from "hardhat";
import { aiverseFundUpgradeModule } from "../../upgrade-module/base-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: aiverseFundUpgrade } = await hre.ignition.deploy(
    aiverseFundUpgradeModule
  );
  console.log(aiverseFundUpgrade.target);
  const aiverseFundTyped = await hre.ethers.getContractAt(
    "AiverseFundV1_0_1",
    aiverseFundUpgrade.target
  );
  expect(await aiverseFundTyped.connect(otherAccount).version()).to.equal(
    "1.0.1"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
