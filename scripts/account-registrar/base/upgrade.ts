/*
npx hardhat run scripts/account-registrar/base/upgrade.ts --network base
*/

import { expect } from "chai";
import hre from "hardhat";
import { accountRegistrarUpgradeModule } from "../../upgrade-module/base";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: accountRegistrarUpgrade } =
    await hre.ignition.deploy(accountRegistrarUpgradeModule);
  console.log(accountRegistrarUpgrade.target);
  const accountRegistrarTyped = await hre.ethers.getContractAt(
    "AccountRegistrarV1_0_6",
    accountRegistrarUpgrade.target
  );
  expect(await accountRegistrarTyped.connect(account).version()).to.equal(
    "1.0.6"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
