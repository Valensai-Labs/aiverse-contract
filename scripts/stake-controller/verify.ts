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

  const StakeControllerAddr = networkAddrs["StakeControllerV1_0_3"];
  const StakeControllerProxyAddr = networkAddrs["StakeControllerProxy"];
  if (!StakeControllerAddr) {
    throw new Error(`StakeController address not found for network ${networkName}`);
  }
  if (!StakeControllerProxyAddr) {
    throw new Error(
      `StakeController Proxy address not found for network ${networkName}`
    );
  }
  console.log(`Verifying contracts on ${networkName}...`);
  console.log("StakeController address:", StakeControllerAddr);
  console.log("StakeControllerProxy address:", StakeControllerProxyAddr);

  try {
    await run("verify:verify", {
      address: StakeControllerAddr,
    });
    const [account, otherAccount] = await ethers.getSigners();
    await run("verify:verify", {
      address: StakeControllerProxyAddr,
      constructorArguments: [StakeControllerAddr, account.address, "0x"],
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
