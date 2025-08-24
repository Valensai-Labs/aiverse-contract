import { expect } from "chai";
import hre from "hardhat";
import { nodeManagerUpgradeModule } from "../../upgrade-module/base-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: nodeManagerUpgrade } = await hre.ignition.deploy(
    nodeManagerUpgradeModule
  );
  console.log(nodeManagerUpgrade.target);
  const nodeManagerTyped = await hre.ethers.getContractAt(
    "NodeManagerV1_0_2",
    nodeManagerUpgrade.target
  );
  expect(await nodeManagerTyped.connect(otherAccount).version()).to.equal(
    "1.0.2"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
