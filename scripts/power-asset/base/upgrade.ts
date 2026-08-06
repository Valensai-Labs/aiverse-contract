/*
npx hardhat run scripts/power-asset/base/upgrade.ts --network base
*/

import { expect } from "chai";
import hre from "hardhat";
import { powerAssetUpgradeModule } from "../../upgrade-module/base";

async function main() {
  const [account] = await hre.ethers.getSigners();
  const { contractInstance: powerAssetUpgrade } = await hre.ignition.deploy(
    powerAssetUpgradeModule
  );
  console.log(powerAssetUpgrade.target);
  const powerAssetTyped = await hre.ethers.getContractAt(
    "PowerAssetV1_0_9",
    powerAssetUpgrade.target
  );
  expect(await powerAssetTyped.connect(account).version()).to.equal("1.0.9");
  console.log(
    "Post-upgrade: after TopUp is on 1.0.1, call PowerAsset.setTopUp(topUpProxy)."
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
