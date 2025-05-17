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

  const CheckInManagerAddr = networkAddrs["CheckInManager"];
  const CheckInManagerProxyAddr = networkAddrs["CheckInManagerProxy"];
  if (!CheckInManagerAddr) {
    throw new Error(
      `CheckInManager address not found for network ${networkName}`
    );
  }
  if (!CheckInManagerProxyAddr) {
    throw new Error(
      `CheckInManager Proxy address not found for network ${networkName}`
    );
  }
  console.log(`Verifying contracts on ${networkName}...`);
  console.log("CheckInManager address:", CheckInManagerAddr);
  console.log("CheckInManagerProxy address:", CheckInManagerProxyAddr);

  try {
    await run("verify:verify", {
      address: CheckInManagerAddr,
    });
    const [account, otherAccount] = await ethers.getSigners();
    await run("verify:verify", {
      address: CheckInManagerProxyAddr,
      constructorArguments: [CheckInManagerAddr, account.address, "0x"],
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
