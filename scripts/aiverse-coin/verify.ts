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

  const AiverseCoinAddr = networkAddrs["AiverseCoin"];
  const AiverseCoinProxyAddr = networkAddrs["AiverseCoinProxy"];
  if (!AiverseCoinAddr) {
    throw new Error(`AiverseCoin address not found for network ${networkName}`);
  }
  if (!AiverseCoinProxyAddr) {
    throw new Error(
      `AiverseCoin Proxy address not found for network ${networkName}`
    );
  }
  console.log(`Verifying contracts on ${networkName}...`);
  console.log("AiverseCoin address:", AiverseCoinAddr);
  console.log("AiverseCoinProxy address:", AiverseCoinProxyAddr);

  try {
    await run("verify:verify", {
      address: AiverseCoinAddr,
    });
    const [account, otherAccount] = await ethers.getSigners();
    await run("verify:verify", {
      address: AiverseCoinProxyAddr,
      constructorArguments: [AiverseCoinAddr, account.address, "0x"],
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
