import { expect } from "chai";
import hre from "hardhat";
import { accountRegistrarUpgradeModule } from "../../upgrade-module/base-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: accountRegistrarUpgrade } =
    await hre.ignition.deploy(accountRegistrarUpgradeModule);
  console.log(accountRegistrarUpgrade.target);
  const accountRegistrarTyped = await hre.ethers.getContractAt(
    "AccountRegistrarV1_0_2",
    accountRegistrarUpgrade.target
  );
  expect(await accountRegistrarTyped.connect(otherAccount).version()).to.equal(
    "1.0.2"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
