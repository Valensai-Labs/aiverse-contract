/*
npx hardhat run scripts/batch-transfer/base/upgrade.ts --network base
*/

import { expect } from "chai";
import hre from "hardhat";
import { batchTransferUpgradeModule } from "../../upgrade-module/base";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: batchTransferUpgrade } = await hre.ignition.deploy(
    batchTransferUpgradeModule
  );
  console.log(batchTransferUpgrade.target);
  const batchTransferTyped = await hre.ethers.getContractAt(
    "BatchTransfer",
    batchTransferUpgrade.target
  );
  expect(await batchTransferTyped.connect(account).version()).to.equal(
    "1.0.0"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

