import * as fs from "fs";
import { ethers, run } from "hardhat";
import * as path from "path";

async function main() {
  const addressPath = path.join(__dirname, "./deployedAddr.json");
  if (!fs.existsSync(addressPath)) {
    console.error("Error: deployedAddr.json not found in the same directory.");
    process.exit(1);
  }
  const addresses = JSON.parse(fs.readFileSync(addressPath, "utf8"));

  const {
    StakeControllerV1_0_7: implementationAddr,
    StakeControllerProxy: proxyAddr,
    StakeControllerProxyAdmin: proxyAdminAddr,
  } = addresses["base-sepolia"];

  if (!implementationAddr || !proxyAddr || !proxyAdminAddr) {
    console.error(
      "Error: One or more contract addresses are missing from deployedAddr.json."
    );
    console.error(`Implementation Address: ${implementationAddr}`);
    console.error(`Proxy Address: ${proxyAddr}`);
    console.error(`Proxy Admin Address: ${proxyAdminAddr}`);
    process.exit(1);
  }

  console.log("Starting verification process for StakeController...");
  console.log(
    `Verifying StakeControllerV1_0_7 (Implementation): ${implementationAddr}`
  );
  console.log(`Verifying TransparentUpgradeableProxy (Proxy): ${proxyAddr}`);
  console.log(`Verifying ProxyAdmin (Admin): ${proxyAdminAddr}`);

  try {
    // 1. Verify Implementation Contract
    await run("verify:verify", {
      address: implementationAddr,
      constructorArguments: [],
    });
    console.log("✅ StakeControllerV1_0_7 implementation verified.");

    // We need the deployer address for constructor arguments
    const [deployer] = await ethers.getSigners();

    // 2. Verify ProxyAdmin Contract
    await run("verify:verify", {
      address: proxyAdminAddr,
      constructorArguments: [deployer.address],
    });
    console.log("✅ ProxyAdmin verified.");

    // 3. Verify Proxy Contract
    await run("verify:verify", {
      address: proxyAddr,
      constructorArguments: [implementationAddr, deployer.address, "0x"],
    });
    console.log("✅ TransparentUpgradeableProxy verified.");

    console.log("\nAll StakeController contracts verified successfully!");
  } catch (error: any) {
    if (error.message.toLowerCase().includes("already verified")) {
      console.log("One or more contracts were already verified.");
    } else {
      console.error("Contract verification failed:", error);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
