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

  const AccountRegistrarAddr = networkAddrs["AccountRegistrar"];
  const AccountRegistrarProxyAddr = networkAddrs["AccountRegistrarProxy"];
  if (!AccountRegistrarAddr) {
    throw new Error(
      `AccountRegistrar address not found for network ${networkName}`
    );
  }
  if (!AccountRegistrarProxyAddr) {
    throw new Error(
      `AccountRegistrar Proxy address not found for network ${networkName}`
    );
  }
  console.log(`Verifying contracts on ${networkName}...`);
  console.log("AccountRegistrar address:", AccountRegistrarAddr);
  console.log("AccountRegistrarProxy address:", AccountRegistrarProxyAddr);

  try {
    await run("verify:verify", {
      address: AccountRegistrarAddr,
    });
    const [account, otherAccount] = await ethers.getSigners();
    await run("verify:verify", {
      address: AccountRegistrarProxyAddr,
      constructorArguments: [AccountRegistrarAddr, account.address, "0x"],
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
