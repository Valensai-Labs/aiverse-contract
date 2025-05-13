// scripts/deploy.ts
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, encodeFunctionData } from "viem";
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const proxyModule = buildModule("ProxyModule", (m) => {
  const proxyAdminOwner = m.getAccount(0);
  const powerAsset = m.contract("PowerAsset");
  const proxy = m.contract("TransparentUpgradeableProxy", [
    powerAsset,
    proxyAdminOwner,
    "0x",
  ]);
  const proxyAdminAddress = m.readEventArgument(
    proxy,
    "AdminChanged",
    "newAdmin"
  );
  const proxyAdmin = m.contractAt("ProxyAdmin", proxyAdminAddress);
  return { proxyAdmin, proxy };
});

const powerAssetModule = buildModule("DemoModule", (m) => {
  const { proxy, proxyAdmin } = m.useModule(proxyModule);
  const powerAsset = m.contractAt("PowerAsset", proxy);
  return { powerAsset, proxy, proxyAdmin };
});

async function main() {
  console.log("开始部署Aiverse合约套件...");
  // 获取部署账户

  const [, otherAccount] = await hre.ethers.getSigners();

  const { powerAsset } = await hre.ignition.deploy(powerAssetModule);

  const powerAssetTyped = await hre.ethers.getContractAt(
    "PowerAsset",
    powerAsset.target
  );

  console.log(powerAsset.target);

  expect(await powerAssetTyped.connect(otherAccount).version()).to.equal(
    "1.0.0"
  );

  // expect(await powerAsset.connect(otherAccount).version()).to.equal("1.0.0");

  // // 获取公共客户端
  // const publicClient = await hre.viem.getPublicClient();

  // // 1. 部署PowerAsset合约
  // console.log("1. 部署PowerAsset合约...");
  // // 获取合约工厂和ABI
  // const powerAssetFactory = await hre.artifacts.readArtifact("PowerAsset");
  // const powerAssetAbi = powerAssetFactory.abi;

  // // 部署实现合约
  // const powerAssetImplementation = await hre.viem.deployContract("PowerAsset");
  // console.log(
  //   `   PowerAsset实现合约部署成功: ${powerAssetImplementation.address}`
  // );

  // // 编码初始化函数调用
  // const powerAssetInitData = encodeFunctionData({
  //   abi: powerAssetAbi,
  //   functionName: "initialize",
  //   args: [],
  // });

  // // 部署代理合约
  // const powerAssetProxy = await hre.viem.deployContract("ERC1967Proxy", [
  //   powerAssetImplementation.address,
  //   powerAssetInitData,
  // ]);
  // console.log(`   PowerAsset代理合约部署成功: ${powerAssetProxy.address}`);

  // // 获取代理合约的PowerAsset接口
  // const powerAsset = await hre.viem.getContractAt(
  //   "PowerAsset",
  //   powerAssetProxy.address
  // );
  // console.log(`   PowerAsset合约初始化成功`);

  // // 2. 部署NodeManager合约
  // console.log("2. 部署NodeManager合约...");
  // // 获取合约工厂和ABI
  // const nodeManagerFactory = await hre.artifacts.readArtifact("NodeManager");
  // const nodeManagerAbi = nodeManagerFactory.abi;

  // // 部署实现合约
  // const nodeManagerImplementation = await hre.viem.deployContract(
  //   "NodeManager"
  // );
  // console.log(
  //   `   NodeManager实现合约部署成功: ${nodeManagerImplementation.address}`
  // );

  // // 编码初始化函数调用
  // const nodeManagerInitData = encodeFunctionData({
  //   abi: nodeManagerAbi,
  //   functionName: "initialize",
  //   args: [],
  // });

  // // 部署代理合约
  // const nodeManagerProxy = await hre.viem.deployContract("ERC1967Proxy", [
  //   nodeManagerImplementation.address,
  //   nodeManagerInitData,
  // ]);
  // console.log(`   NodeManager代理合约部署成功: ${nodeManagerProxy.address}`);

  // // 获取代理合约的NodeManager接口
  // const nodeManager = await hre.viem.getContractAt(
  //   "NodeManager",
  //   nodeManagerProxy.address
  // );
  // console.log(`   NodeManager合约初始化成功`);

  // // 3. 部署AiverseCoin合约
  // console.log("3. 部署AiverseCoin合约...");
  // // 获取合约工厂和ABI
  // const aiverseCoinFactory = await hre.artifacts.readArtifact("AiverseCoin");
  // const aiverseCoinAbi = aiverseCoinFactory.abi;

  // // 部署实现合约
  // const aiverseCoinImplementation = await hre.viem.deployContract(
  //   "AiverseCoin"
  // );
  // console.log(
  //   `   AiverseCoin实现合约部署成功: ${aiverseCoinImplementation.address}`
  // );

  // // 编码初始化函数调用
  // const aiverseCoinInitData = encodeFunctionData({
  //   abi: aiverseCoinAbi,
  //   functionName: "initialize",
  //   args: ["Aiverse Coin", "AIC"],
  // });

  // // 部署代理合约
  // const aiverseCoinProxy = await hre.viem.deployContract("ERC1967Proxy", [
  //   aiverseCoinImplementation.address,
  //   aiverseCoinInitData,
  // ]);
  // console.log(`   AiverseCoin代理合约部署成功: ${aiverseCoinProxy.address}`);

  // // 获取代理合约的AiverseCoin接口
  // const aiverseCoin = await hre.viem.getContractAt(
  //   "AiverseCoin",
  //   aiverseCoinProxy.address
  // );
  // console.log(`   AiverseCoin合约初始化成功`);

  // // 4. 部署AccountRegistrar合约
  // console.log("4. 部署AccountRegistrar合约...");
  // // 获取合约工厂和ABI
  // const accountRegistrarFactory = await hre.artifacts.readArtifact(
  //   "AccountRegistrar"
  // );
  // const accountRegistrarAbi = accountRegistrarFactory.abi;

  // // 部署实现合约
  // const accountRegistrarImplementation = await hre.viem.deployContract(
  //   "AccountRegistrar"
  // );
  // console.log(
  //   `   AccountRegistrar实现合约部署成功: ${accountRegistrarImplementation.address}`
  // );

  // // 编码初始化函数调用
  // const accountRegistrarInitData = encodeFunctionData({
  //   abi: accountRegistrarAbi,
  //   functionName: "initialize",
  //   args: [powerAsset.address],
  // });

  // // 部署代理合约
  // const accountRegistrarProxy = await hre.viem.deployContract("ERC1967Proxy", [
  //   accountRegistrarImplementation.address,
  //   accountRegistrarInitData,
  // ]);
  // console.log(
  //   `   AccountRegistrar代理合约部署成功: ${accountRegistrarProxy.address}`
  // );

  // // 获取代理合约的AccountRegistrar接口
  // const accountRegistrar = await hre.viem.getContractAt(
  //   "AccountRegistrar",
  //   accountRegistrarProxy.address
  // );
  // console.log(`   AccountRegistrar合约初始化成功`);

  // // 5. 部署CheckInManager合约
  // console.log("5. 部署CheckInManager合约...");
  // // 获取合约工厂和ABI
  // const checkInManagerFactory = await hre.artifacts.readArtifact(
  //   "CheckInManager"
  // );
  // const checkInManagerAbi = checkInManagerFactory.abi;

  // // 部署实现合约
  // const checkInManagerImplementation = await hre.viem.deployContract(
  //   "CheckInManager"
  // );
  // console.log(
  //   `   CheckInManager实现合约部署成功: ${checkInManagerImplementation.address}`
  // );

  // // 编码初始化函数调用
  // const checkInManagerInitData = encodeFunctionData({
  //   abi: checkInManagerAbi,
  //   functionName: "initialize",
  //   args: [
  //     nodeManager.address,
  //     accountRegistrar.address,
  //     powerAsset.address,
  //     deployer.account.address, // owner
  //   ],
  // });

  // // 部署代理合约
  // const checkInManagerProxy = await hre.viem.deployContract("ERC1967Proxy", [
  //   checkInManagerImplementation.address,
  //   checkInManagerInitData,
  // ]);
  // console.log(
  //   `   CheckInManager代理合约部署成功: ${checkInManagerProxy.address}`
  // );

  // // 获取代理合约的CheckInManager接口
  // const checkInManager = await hre.viem.getContractAt(
  //   "CheckInManager",
  //   checkInManagerProxy.address
  // );
  // console.log(`   CheckInManager合约初始化成功`);

  // // 6. 部署StakeController合约
  // console.log("6. 部署StakeController合约...");
  // // 获取合约工厂和ABI
  // const stakeControllerFactory = await hre.artifacts.readArtifact(
  //   "StakeController"
  // );
  // const stakeControllerAbi = stakeControllerFactory.abi;

  // // 部署实现合约
  // const stakeControllerImplementation = await hre.viem.deployContract(
  //   "StakeController"
  // );
  // console.log(
  //   `   StakeController实现合约部署成功: ${stakeControllerImplementation.address}`
  // );

  // // 编码初始化函数调用
  // const stakeControllerInitData = encodeFunctionData({
  //   abi: stakeControllerAbi,
  //   functionName: "initialize",
  //   args: [aiverseCoin.address, powerAsset.address, nodeManager.address],
  // });

  // // 部署代理合约
  // const stakeControllerProxy = await hre.viem.deployContract("ERC1967Proxy", [
  //   stakeControllerImplementation.address,
  //   stakeControllerInitData,
  // ]);
  // console.log(
  //   `   StakeController代理合约部署成功: ${stakeControllerProxy.address}`
  // );

  // // 获取代理合约的StakeController接口
  // const stakeController = await hre.viem.getContractAt(
  //   "StakeController",
  //   stakeControllerProxy.address
  // );
  // console.log(`   StakeController合约初始化成功`);

  // // 7. 配置合约间的关系
  // console.log("7. 配置合约间的关系...");

  // // 7.1 设置AiverseCoin的StakeController
  // console.log("   7.1 设置AiverseCoin的StakeController...");
  // const setStakeControllerTx = await aiverseCoin.write.setStakeController([
  //   stakeController.address,
  // ]);
  // await publicClient.waitForTransactionReceipt({ hash: setStakeControllerTx });
  // console.log("       设置成功");

  // // 7.2 设置PowerAsset的AccountRegistrar
  // console.log("   7.2 设置PowerAsset的AccountRegistrar...");
  // const setAccountRegistrarTx = await powerAsset.write.setAccountRegistrar([
  //   accountRegistrar.address,
  // ]);
  // await publicClient.waitForTransactionReceipt({ hash: setAccountRegistrarTx });
  // console.log("       设置成功");

  // // 7.3 设置PowerAsset的CheckInManager
  // console.log("   7.3 设置PowerAsset的CheckInManager...");
  // const setCheckInManagerTx = await powerAsset.write.setCheckInManager([
  //   checkInManager.address,
  // ]);
  // await publicClient.waitForTransactionReceipt({ hash: setCheckInManagerTx });
  // console.log("       设置成功");

  // // 7.4 设置PowerAsset的StakeController
  // console.log("   7.4 设置PowerAsset的StakeController...");
  // const setPowerAssetStakeControllerTx =
  //   await powerAsset.write.setStakeController([stakeController.address]);
  // await publicClient.waitForTransactionReceipt({
  //   hash: setPowerAssetStakeControllerTx,
  // });
  // console.log("       设置成功");

  // // 8. 添加初始节点（可选）
  // console.log("8. 添加初始节点...");
  // const addNodeTx = await nodeManager.write.addNode([
  //   getAddress(deployer.account.address),
  // ]);
  // await publicClient.waitForTransactionReceipt({ hash: addNodeTx });
  // console.log(`   已添加初始节点: ${deployer.account.address}`);

  // // 9. 验证部署
  // console.log("9. 验证部署...");

  // // 验证AiverseCoin设置
  // const stakeControllerFromAIC = await aiverseCoin.read.stakeController();
  // expect(getAddress(stakeControllerFromAIC)).to.equal(
  //   getAddress(stakeController.address)
  // );
  // console.log("   AiverseCoin配置验证成功");

  // // 验证PowerAsset设置
  // const accountRegistrarFromPA = await powerAsset.read.accountRegistrar();
  // const checkInManagerFromPA = await powerAsset.read.checkInManager();
  // const stakeControllerFromPA = await powerAsset.read.stakeController();

  // expect(getAddress(accountRegistrarFromPA)).to.equal(
  //   getAddress(accountRegistrar.address)
  // );
  // expect(getAddress(checkInManagerFromPA)).to.equal(
  //   getAddress(checkInManager.address)
  // );
  // expect(getAddress(stakeControllerFromPA)).to.equal(
  //   getAddress(stakeController.address)
  // );
  // console.log("   PowerAsset配置验证成功");

  // // 验证NodeManager设置
  // const isNode = await nodeManager.read.isNode([
  //   getAddress(deployer.account.address),
  // ]);
  // expect(isNode).to.be.true;
  // console.log("   NodeManager配置验证成功");

  // console.log("\n部署完成！合约地址汇总:");
  // console.log(`PowerAsset (代理): ${powerAsset.address}`);
  // console.log(`NodeManager (代理): ${nodeManager.address}`);
  // console.log(`AiverseCoin (代理): ${aiverseCoin.address}`);
  // console.log(`AccountRegistrar (代理): ${accountRegistrar.address}`);
  // console.log(`CheckInManager (代理): ${checkInManager.address}`);
  // console.log(`StakeController (代理): ${stakeController.address}`);
}

// 执行部署脚本
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
