import { expect } from "chai";
import hre from "hardhat";
import { aiverseCoinUpgradeModule } from "../../upgrade-module/eth-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: aiverseCoinUpgrade } = await hre.ignition.deploy(
    aiverseCoinUpgradeModule
  );
  console.log(aiverseCoinUpgrade.target);
  const aiverseCoinTyped = await hre.ethers.getContractAt(
    "AiverseCoinV1_0_2",
    aiverseCoinUpgrade.target
  );
  expect(await aiverseCoinTyped.connect(otherAccount).version()).to.equal(
    "1.0.2"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
