import { expect } from "chai";
import hre from "hardhat";
import { aiverseCoinModule } from "../../proxy-module/base";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: aiverseCoin } = await hre.ignition.deploy(
    aiverseCoinModule
  );
  console.log(aiverseCoin.target);
  const aiverseCoinTyped = await hre.ethers.getContractAt(
    "AiverseCoinV1_0_4",
    aiverseCoin.target
  );
  expect(await aiverseCoinTyped.connect(otherAccount).version()).to.equal(
    "1.0.4"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
