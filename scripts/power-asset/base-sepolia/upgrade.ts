/*
npx hardhat run scripts/power-asset/base-sepolia/upgrade.ts --network base-sepolia
*/

import { expect } from "chai";
import hre from "hardhat";
import { powerAssetUpgradeModule } from "../../upgrade-module/base-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: powerAssetUpgrade } = await hre.ignition.deploy(
    powerAssetUpgradeModule
  );
  console.log(powerAssetUpgrade.target);
  const powerAssetTyped = await hre.ethers.getContractAt(
    "PowerAssetV1_0_7",
    powerAssetUpgrade.target
  );
  expect(await powerAssetTyped.connect(otherAccount).version()).to.equal(
    "1.0.7"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
