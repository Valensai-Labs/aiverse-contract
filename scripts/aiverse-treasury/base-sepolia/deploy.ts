/*
npx hardhat run scripts/aiverse-treasury/base-sepolia/deploy.ts --network base-sepolia
*/

import { expect } from "chai";
import hre from "hardhat";
import { aiverseTreasuryModule } from "../../proxy-module/base-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: aiverseTreasury } = await hre.ignition.deploy(
    aiverseTreasuryModule
  );
  console.log(aiverseTreasury.target);
  const aiverseTreasuryTyped = await hre.ethers.getContractAt(
    "AiverseTreasuryV1_0_1",
    aiverseTreasury.target
  );
  expect(await aiverseTreasuryTyped.connect(otherAccount).version()).to.equal(
    "1.0.1"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
