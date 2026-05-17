/*
npx hardhat run scripts/aiverse-topup/base-sepolia/deploy.ts --network base-sepolia
*/

import { expect } from "chai";
import hre from "hardhat";
import { aiverseTopUpModule } from "../../proxy-module/base-sepolia";

async function main() {
  const [, otherAccount] = await hre.ethers.getSigners();
  const { contractInstance: aiverseTopUp } = await hre.ignition.deploy(
    aiverseTopUpModule
  );
  console.log(aiverseTopUp.target);
  const aiverseTopUpTyped = await hre.ethers.getContractAt(
    "AiverseTopUp",
    aiverseTopUp.target
  );
  expect(await aiverseTopUpTyped.connect(otherAccount).version()).to.equal(
    "1.0.0"
  );
  console.log(
    "Proxy deployed. Call initialize(initialOwner, usdc_, treasury_, initialPlatform) on the proxy before use."
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
