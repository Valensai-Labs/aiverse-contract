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

  const NodeManagerAddr = networkAddrs["NodeManagerV1_0_1"];
  const NodeManagerProxyAddr = networkAddrs["NodeManagerProxy"];
  if (!NodeManagerAddr) {
    throw new Error(`NodeManager address not found for network ${networkName}`);
  }
  if (!NodeManagerProxyAddr) {
    throw new Error(
      `NodeManager Proxy address not found for network ${networkName}`
    );
  }
  console.log(`Verifying contracts on ${networkName}...`);
  console.log("NodeManager address:", NodeManagerAddr);
  console.log("NodeManagerProxy address:", NodeManagerProxyAddr);

  try {
    await run("verify:verify", {
      address: NodeManagerAddr,
    });
    const [account, otherAccount] = await ethers.getSigners();
    await run("verify:verify", {
      address: NodeManagerProxyAddr,
      constructorArguments: [NodeManagerAddr, account.address, "0x"],
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
