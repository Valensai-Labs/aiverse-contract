import { expect } from "chai";
import hre from "hardhat";
import { nodeManagerModule } from "../../proxy-module/base-sepolia";

async function main() {
  const [account, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: nodeManager } = await hre.ignition.deploy(
    nodeManagerModule
  );
  console.log(nodeManager.target);
  const nodeManagerTyped = await hre.ethers.getContractAt(
    "NodeManagerV1_0_2",
    nodeManager.target
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
