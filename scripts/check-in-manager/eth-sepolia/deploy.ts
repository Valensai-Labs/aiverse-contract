/*
npx hardhat run scripts/check-in-manager/eth-sepolia/deploy.ts --network sepolia
*/

import { expect } from "chai";
import hre from "hardhat";
import { checkInManagerModule } from "../../proxy-module/eth-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: checkInManager } = await hre.ignition.deploy(
    checkInManagerModule
  );
  console.log(checkInManager.target);
  const checkInManagerTyped = await hre.ethers.getContractAt(
    "CheckInManager",
    checkInManager.target
  );
  expect(await checkInManagerTyped.connect(otherAccount).version()).to.equal(
    "1.0.0"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
