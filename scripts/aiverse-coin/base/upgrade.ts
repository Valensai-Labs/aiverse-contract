import { expect } from "chai";
import hre from "hardhat";
import { aiverseCoinUpgradeModule } from "../../upgrade-module/base";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: aiverseCoinUpgrade } = await hre.ignition.deploy(
    aiverseCoinUpgradeModule
  );
  console.log(aiverseCoinUpgrade.target);
  const aiverseCoinTyped = await hre.ethers.getContractAt(
    "AiverseCoinV1_0_4",
    aiverseCoinUpgrade.target
  );
  expect(await aiverseCoinTyped.connect(account).version()).to.equal(
    "1.0.4"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
