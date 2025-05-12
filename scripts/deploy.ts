// deploy.ts - Aiverse合约部署脚本

import { expect } from "chai";
import hre from "hardhat";
import { getAddress } from "viem";

async function main() {
  console.log("开始部署Aiverse合约套件...");

  // 获取部署账户
  const [deployer] = await hre.viem.getWalletClients();
  console.log(`使用部署账户: ${deployer.account.address}`);

  // 获取公共客户端
  const publicClient = await hre.viem.getPublicClient();

  // 1. 部署AiverseCoin合约
  console.log("1. 部署AiverseCoin合约...");
  const aiverseCoin = await hre.viem.deployContract("AiverseCoin", [
    "Aiverse Coin", // 代币名称
    "AIC"           // 代币符号
  ]);
  console.log(`   AiverseCoin部署成功: ${aiverseCoin.address}`);

  // 2. 部署PowerAsset合约
  console.log("2. 部署PowerAsset合约...");
  const powerAsset = await hre.viem.deployContract("PowerAsset", []);
  console.log(`   PowerAsset部署成功: ${powerAsset.address}`);

  // 3. 部署NodeManager合约
  console.log("3. 部署NodeManager合约...");
  const nodeManager = await hre.viem.deployContract("NodeManager", []);
  console.log(`   NodeManager部署成功: ${nodeManager.address}`);

  // 4. 部署AccountRegistrar合约
  console.log("4. 部署AccountRegistrar合约...");
  const accountRegistrar = await hre.viem.deployContract("AccountRegistrar", [
    powerAsset.address
  ]);
  console.log(`   AccountRegistrar部署成功: ${accountRegistrar.address}`);

  // 5. 部署CheckInManager合约
  console.log("5. 部署CheckInManager合约...");
  const checkInManager = await hre.viem.deployContract("CheckInManager", [
    nodeManager.address,
    accountRegistrar.address,
    powerAsset.address
  ]);
  console.log(`   CheckInManager部署成功: ${checkInManager.address}`);

  // 6. 部署StakeController合约
  console.log("6. 部署StakeController合约...");
  const stakeController = await hre.viem.deployContract("StakeController", [
    aiverseCoin.address,
    powerAsset.address,
    nodeManager.address
  ]);
  console.log(`   StakeController部署成功: ${stakeController.address}`);

  // 7. 配置合约间的关系
  console.log("7. 配置合约间的关系...");

  // 7.1 设置AiverseCoin的StakeController
  console.log("   7.1 设置AiverseCoin的StakeController...");
  const setStakeControllerTx = await aiverseCoin.write.setStakeController([
    stakeController.address
  ]);
  await publicClient.waitForTransactionReceipt({ hash: setStakeControllerTx });
  console.log("       设置成功");

  // 7.2 设置PowerAsset的AccountRegistrar
  console.log("   7.2 设置PowerAsset的AccountRegistrar...");
  const setAccountRegistrarTx = await powerAsset.write.setAccountRegistrar([
    accountRegistrar.address
  ]);
  await publicClient.waitForTransactionReceipt({ hash: setAccountRegistrarTx });
  console.log("       设置成功");

  // 7.3 设置PowerAsset的CheckInManager
  console.log("   7.3 设置PowerAsset的CheckInManager...");
  const setCheckInManagerTx = await powerAsset.write.setCheckInManager([
    checkInManager.address
  ]);
  await publicClient.waitForTransactionReceipt({ hash: setCheckInManagerTx });
  console.log("       设置成功");

  // 7.4 设置PowerAsset的StakeController
  console.log("   7.4 设置PowerAsset的StakeController...");
  const setPowerAssetStakeControllerTx = await powerAsset.write.setStakeController([
    stakeController.address
  ]);
  await publicClient.waitForTransactionReceipt({ hash: setPowerAssetStakeControllerTx });
  console.log("       设置成功");

  // 8. 添加初始节点（可选）
  console.log("8. 添加初始节点...");
  const addNodeTx = await nodeManager.write.addNode([
    getAddress(deployer.account.address)
  ]);
  await publicClient.waitForTransactionReceipt({ hash: addNodeTx });
  console.log(`   已添加初始节点: ${deployer.account.address}`);

  // 9. 验证部署
  console.log("9. 验证部署...");

  // 验证AiverseCoin设置
  const stakeControllerFromAIC = await aiverseCoin.read.stakeController();
  expect(getAddress(stakeControllerFromAIC)).to.equal(getAddress(stakeController.address));
  console.log("   AiverseCoin配置验证成功");

  // 验证PowerAsset设置
  const accountRegistrarFromPA = await powerAsset.read.accountRegistrar();
  const checkInManagerFromPA = await powerAsset.read.checkInManager();
  const stakeControllerFromPA = await powerAsset.read.stakeController();
  
  expect(getAddress(accountRegistrarFromPA)).to.equal(getAddress(accountRegistrar.address));
  expect(getAddress(checkInManagerFromPA)).to.equal(getAddress(checkInManager.address));
  expect(getAddress(stakeControllerFromPA)).to.equal(getAddress(stakeController.address));
  console.log("   PowerAsset配置验证成功");

  // 验证NodeManager设置
  const isNode = await nodeManager.read.isNode([getAddress(deployer.account.address)]);
  expect(isNode).to.be.true;
  console.log("   NodeManager配置验证成功");

  console.log("\n部署完成！合约地址汇总:");
  console.log(`AiverseCoin: ${aiverseCoin.address}`);
  console.log(`PowerAsset: ${powerAsset.address}`);
  console.log(`NodeManager: ${nodeManager.address}`);
  console.log(`AccountRegistrar: ${accountRegistrar.address}`);
  console.log(`CheckInManager: ${checkInManager.address}`);
  console.log(`StakeController: ${stakeController.address}`);
}

// 执行部署脚本
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
