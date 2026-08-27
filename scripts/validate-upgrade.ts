/*
   # Base 主网
   npx hardhat run scripts/validate-upgrade.ts --network base
   
   # Base Sepolia 测试网
   npx hardhat run scripts/validate-upgrade.ts --network base-sepolia
*/

import hre from "hardhat";

async function main() {
  // ============================================
  // 配置区域 - 请根据实际情况修改
  // ============================================
  const CONFIG = {
    // 代理合约地址（已部署的）
    proxyAddress: "0x0000000670ec6A87848b2bDA55533930AAEd0EfC",
    
    // 旧版本实现合约地址（已部署的）
    oldImplementationAddress: "0x12B3Eca4666006F093B728732706792a844048Ac",
    
    // 旧版本合约名称（用于 forceImport）
    oldContractName: "AiverseTopUp",
    
    // 新版本合约名称
    newContractName: "AiverseTopUpV1_0_2",
    
    // 代理类型: "transparent" 或 "uups"
    proxyKind: "transparent" as "transparent" | "uups",
  };
  // ============================================

  const network = hre.network.name;
  console.log(`\n🔍 Validating upgrade...`);
  console.log(`Network: ${network}`);
  console.log(`Proxy Address: ${CONFIG.proxyAddress}`);
  console.log(`Old Implementation: ${CONFIG.oldImplementationAddress}`);
  console.log(`New Contract: ${CONFIG.newContractName}`);
  console.log(`Proxy Kind: ${CONFIG.proxyKind}`);

  try {
    // 获取旧版本合约工厂（用于 forceImport）
    const OldContract = await hre.ethers.getContractFactory(
      CONFIG.oldContractName
    );

    // 获取新版本合约工厂
    const NewContract = await hre.ethers.getContractFactory(
      CONFIG.newContractName
    );

    console.log(`\n📋 Registering old implementation...`);
    
    // 注册旧版本实现合约（如果未注册）
    await hre.upgrades.forceImport(
      CONFIG.proxyAddress,
      OldContract,
      {
        kind: CONFIG.proxyKind,
      }
    );

    console.log(`\n📋 Checking storage layout compatibility...`);

    // 验证升级兼容性
    await hre.upgrades.validateUpgrade(
      CONFIG.proxyAddress,
      NewContract,
      {
        kind: CONFIG.proxyKind,
      }
    );

    console.log(`\n✅ Storage layout validation passed!`);
    console.log(`✅ No conflicts detected. Safe to upgrade.`);
  } catch (error: any) {
    console.error(`\n❌ Storage layout validation failed!`);
    console.error(`\nError details:`);
    console.error(error.message || error);

    if (error.message?.includes("New storage layout is incompatible")) {
      console.error(`\n⚠️  Storage layout conflict detected!`);
      console.error(`Please check:`);
      console.error(`1. Variable order must remain the same`);
      console.error(`2. New variables must be added at the end`);
      console.error(`3. Existing variables cannot be removed or reordered`);
    }

    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
