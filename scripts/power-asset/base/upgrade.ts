import { expect } from "chai";
import hre from "hardhat";
import { powerAssetUpgradeModule } from "../../upgrade-module/base";

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
  expect(await powerAssetTyped.connect(account).version()).to.equal(
    "1.0.7"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
