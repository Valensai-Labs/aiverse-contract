import { expect } from "chai";
import hre from "hardhat";
import { aiverseFundModule } from "../../proxy-module/base-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: aiverseFund } = await hre.ignition.deploy(
    aiverseFundModule
  );
  console.log(aiverseFund.target);
  const aiverseFundTyped = await hre.ethers.getContractAt(
    "AiverseFundV1_0_1",
    aiverseFund.target
  );
  expect(await aiverseFundTyped.connect(otherAccount).version()).to.equal(
    "1.0.1"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
