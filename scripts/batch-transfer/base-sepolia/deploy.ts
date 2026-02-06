/*
npx hardhat run scripts/batch-transfer/base-sepolia/deploy.ts --network base-sepolia
*/

import { expect } from "chai";
import hre from "hardhat";
import { batchTransferModule } from "../../proxy-module/base-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: batchTransfer } = await hre.ignition.deploy(
    batchTransferModule
  );
  console.log(batchTransfer.target);
  const batchTransferTyped = await hre.ethers.getContractAt(
    "BatchTransfer",
    batchTransfer.target
  );
  expect(await batchTransferTyped.connect(otherAccount).version()).to.equal(
    "1.0.0"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

