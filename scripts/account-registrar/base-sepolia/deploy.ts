/*
npx hardhat run scripts/account-registrar/base-sepolia/deploy.ts --network base-sepolia
*/

import { expect } from "chai";
import hre from "hardhat";
import { accountRegistrarModule } from "../../proxy-module/base-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: accountRegistrar } = await hre.ignition.deploy(
    accountRegistrarModule
  );
  console.log(accountRegistrar.target);
  const accountRegistrarTyped = await hre.ethers.getContractAt(
    "AccountRegistrarV1_0_2",
    accountRegistrar.target
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
