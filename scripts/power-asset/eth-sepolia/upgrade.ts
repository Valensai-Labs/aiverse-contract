import { expect } from "chai";
import hre from "hardhat";
import { powerAssetUpgradeModule } from "../../upgrade-module/eth-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: powerAssetUpgrade } = await hre.ignition.deploy(
    powerAssetUpgradeModule
  );
  console.log(powerAssetUpgrade.target);
  const powerAssetTyped = await hre.ethers.getContractAt(
    "PowerAssetV1_0_3",
    powerAssetUpgrade.target
  );
  expect(await powerAssetTyped.connect(otherAccount).version()).to.equal(
    "1.0.3"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
