import { expect } from "chai";
import hre from "hardhat";
import { powerAssetModule } from "../../proxy-module/base-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: powerAsset } = await hre.ignition.deploy(
    powerAssetModule
  );
  console.log(powerAsset.target);
  const powerAssetTyped = await hre.ethers.getContractAt(
    "PowerAssetV1_0_3",
    powerAsset.target
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
