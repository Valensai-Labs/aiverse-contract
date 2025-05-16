import { run, network, ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const addressPath = path.join(__dirname, "./deployedAddr.json");
  const addresses = JSON.parse(fs.readFileSync(addressPath, "utf8"));
  const networkName = network.name;
  const networkAddrs = addresses[networkName];
  if (!networkAddrs) {
    throw new Error(`No addresses found for network ${networkName}`);
  }

  const PowerAssetAddr = networkAddrs["PowerAsset"];
  const PowerAssetProxyAddr = networkAddrs["PowerAssetProxy"];
  if (!PowerAssetAddr) {
    throw new Error(`PowerAsset address not found for network ${networkName}`);
  }
  if (!PowerAssetProxyAddr) {
    throw new Error(
      `PowerAsset Proxy address not found for network ${networkName}`
    );
  }
  console.log(`Verifying contracts on ${networkName}...`);
  console.log("PowerAsset address:", PowerAssetAddr);
  console.log("PowerAssetProxy address:", PowerAssetProxyAddr);

  try {
    await run("verify:verify", {
      address: PowerAssetAddr,
    });
    const [account, otherAccount] = await ethers.getSigners();
    await run("verify:verify", {
      address: PowerAssetProxyAddr,
      constructorArguments: [PowerAssetAddr, account.address, "0x"],
    });
    console.log("Contract verification successful");
  } catch (error) {
    console.error("Contract verification failed", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
