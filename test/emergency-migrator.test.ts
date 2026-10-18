import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Signer } from "ethers";
import { ethers, upgrades } from "hardhat";

const SCOPE = ethers.id("PARTICLE_EXIT_FULL_V1");
const COMPENSATION = ethers.parseEther("500");
const VALIDITY = 2 * 60;
const EXISTING_POWER = 40n;
const RELEASE_POWER = 60n;
const EXISTING_AICOIN = 7n;
const RELEASE_AICOIN = 11n;

const MIGRATION_TYPES = {
  Migration: [
    { name: "operationId", type: "bytes32" },
    { name: "emailHash", type: "bytes32" },
    { name: "oldAddr", type: "address" },
    { name: "newAddr", type: "address" },
    { name: "node", type: "address" },
    { name: "scopeHash", type: "bytes32" },
    { name: "chainId", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "configEpoch", type: "uint256" },
  ],
};

async function deployBase() {
  const [owner, relayer, migrationSigner, oldAccount, newAccount, node, other] =
    await ethers.getSigners();
  const registrar = await ethers.deployContract("MockAccountRegistrar");
  const power = await ethers.deployContract("MockMigratableAsset");
  const aicoin = await ethers.deployContract("MockMigratableAsset");
  const stake = await ethers.deployContract("MockStakeController", [
    await power.getAddress(),
    await aicoin.getAddress(),
  ]);

  const factory = await ethers.getContractFactory("EmergencyMigrator");
  const migrator = await upgrades.deployProxy(factory, [
    await registrar.getAddress(),
    await stake.getAddress(),
    await power.getAddress(),
    await aicoin.getAddress(),
    migrationSigner.address,
  ]);

  return {
    owner,
    relayer,
    migrationSigner,
    oldAccount,
    newAccount,
    node,
    other,
    registrar,
    power,
    aicoin,
    stake,
    migrator,
    emailHash: ethers.id("alice@example.com"),
    operationId: ethers.id("op-1"),
  };
}

async function deployReady() {
  const env = await deployBase();
  await env.migrator.setRelayer(env.relayer.address, true);
  await env.registrar.setEmailHash(env.oldAccount.address, env.emailHash);
  await env.registrar.setEmailHashToAddr(env.emailHash, env.oldAccount.address);
  return env;
}

type Ready = Awaited<ReturnType<typeof deployReady>>;

async function migrate(
  env: Ready,
  overrides: {
    operationId?: string;
    emailHash?: string;
    oldAddr?: string;
    newAddr?: string;
    node?: string;
    scopeHash?: string;
    deadline?: bigint;
    configEpoch?: bigint;
    chainId?: bigint;
    userWallet?: Signer;
    platformWallet?: Signer;
    caller?: Signer;
  } = {}
) {
  const operationId = overrides.operationId ?? env.operationId;
  const emailHash = overrides.emailHash ?? env.emailHash;
  const oldAddr = overrides.oldAddr ?? env.oldAccount.address;
  const newAddr = overrides.newAddr ?? env.newAccount.address;
  const node = overrides.node ?? env.node.address;
  const scopeHash = overrides.scopeHash ?? SCOPE;
  const deadline = overrides.deadline ?? BigInt((await time.latest()) + 60);
  const configEpoch =
    overrides.configEpoch ?? (await env.migrator.configEpoch());
  const chainId =
    overrides.chainId ?? (await ethers.provider.getNetwork()).chainId;
  const userWallet = overrides.userWallet ?? env.newAccount;
  const platformWallet = overrides.platformWallet ?? env.migrationSigner;

  const domain = {
    name: "EmergencyMigrator",
    version: "1",
    chainId,
    verifyingContract: await env.migrator.getAddress(),
  };
  const message = {
    operationId,
    emailHash,
    oldAddr,
    newAddr,
    node,
    scopeHash,
    chainId,
    deadline,
    configEpoch,
  };
  const userSig = await userWallet.signTypedData(domain, MIGRATION_TYPES, message);
  const platformSig = await platformWallet.signTypedData(
    domain,
    MIGRATION_TYPES,
    message
  );

  return env.migrator
    .connect(overrides.caller ?? env.relayer)
    .migrate(
      operationId,
      emailHash,
      oldAddr,
      newAddr,
      node,
      scopeHash,
      deadline,
      configEpoch,
      userSig,
      platformSig
    );
}

describe("EmergencyMigrator", function () {
  it("initializes the linked contracts and rejects a second init", async function () {
    const { migrator, owner, migrationSigner, registrar, stake, power, aicoin } =
      await loadFixture(deployBase);

    expect(await migrator.version()).to.equal("1.0.0");
    expect(await migrator.owner()).to.equal(owner.address);
    expect(await migrator.accountRegistrar()).to.equal(await registrar.getAddress());
    expect(await migrator.stakeController()).to.equal(await stake.getAddress());
    expect(await migrator.powerAsset()).to.equal(await power.getAddress());
    expect(await migrator.aiverseCoin()).to.equal(await aicoin.getAddress());
    expect(await migrator.migrationSigner()).to.equal(migrationSigner.address);
    expect(await migrator.configEpoch()).to.equal(0n);
    expect(await migrator.MIGRATION_SCOPE_HASH()).to.equal(SCOPE);
    expect(await migrator.MIGRATION_COMPENSATION()).to.equal(COMPENSATION);
    expect(await migrator.MAX_SIGNATURE_VALIDITY()).to.equal(VALIDITY);
    expect(await migrator.relayers(owner.address)).to.equal(false);

    const domain = await migrator.eip712Domain();
    expect(domain.name).to.equal("EmergencyMigrator");
    expect(domain.version).to.equal("1");

    await expect(
      migrator.initialize(
        await registrar.getAddress(),
        await stake.getAddress(),
        await power.getAddress(),
        await aicoin.getAddress(),
        migrationSigner.address
      )
    ).to.be.revertedWithCustomError(migrator, "InvalidInitialization");

    const factory = await ethers.getContractFactory("EmergencyMigrator");
    await expect(
      upgrades.deployProxy(factory, [
        ethers.ZeroAddress,
        await stake.getAddress(),
        await power.getAddress(),
        await aicoin.getAddress(),
        migrationSigner.address,
      ])
    ).to.be.revertedWith("Invalid registrar");
    await expect(
      upgrades.deployProxy(factory, [
        await registrar.getAddress(),
        await stake.getAddress(),
        await power.getAddress(),
        await aicoin.getAddress(),
        ethers.ZeroAddress,
      ])
    ).to.be.revertedWith("Invalid migration signer");
  });

  it("updates the signer, relayer, and linked contracts", async function () {
    const env = await loadFixture(deployReady);
    const { migrator, relayer, migrationSigner, other, registrar, stake, power, aicoin } =
      env;

    await expect(migrator.setMigrationSigner(other.address))
      .to.emit(migrator, "MigrationSignerUpdated")
      .withArgs(migrationSigner.address, other.address);
    expect(await migrator.migrationSigner()).to.equal(other.address);
    await expect(
      migrator.setMigrationSigner(ethers.ZeroAddress)
    ).to.be.revertedWith("Invalid migration signer");
    await expect(
      migrator.connect(other).setMigrationSigner(migrationSigner.address)
    ).to.be.revertedWithCustomError(migrator, "OwnableUnauthorizedAccount");

    await expect(migrator.setRelayer(other.address, true))
      .to.emit(migrator, "RelayerUpdated")
      .withArgs(other.address, true);
    expect(await migrator.relayers(other.address)).to.equal(true);
    await migrator.setRelayer(relayer.address, false);
    await expect(migrate(env)).to.be.revertedWith("Caller is not a relayer");
    await expect(
      migrator.setRelayer(ethers.ZeroAddress, true)
    ).to.be.revertedWith("Invalid relayer");

    const nextPower = await ethers.deployContract("MockMigratableAsset");
    await expect(
      migrator.setLinkedContracts(
        await registrar.getAddress(),
        await stake.getAddress(),
        await nextPower.getAddress(),
        await aicoin.getAddress()
      )
    )
      .to.emit(migrator, "LinkedContractsUpdated")
      .withArgs(
        await registrar.getAddress(),
        await stake.getAddress(),
        await nextPower.getAddress(),
        await aicoin.getAddress(),
        1n
      );
    expect(await migrator.configEpoch()).to.equal(1n);
    expect(await migrator.powerAsset()).to.equal(await nextPower.getAddress());
    await expect(
      migrator.setLinkedContracts(
        ethers.ZeroAddress,
        await stake.getAddress(),
        await power.getAddress(),
        await aicoin.getAddress()
      )
    ).to.be.revertedWith("Invalid registrar");
    await expect(migrator.connect(other).pause()).to.be.revertedWithCustomError(
      migrator,
      "OwnableUnauthorizedAccount"
    );
  });

  it("moves wallet balances, unstake proceeds, and compensation", async function () {
    const env = await loadFixture(deployReady);
    const { migrator, power, aicoin, stake, oldAccount, newAccount, node } = env;
    await power.mint(oldAccount.address, EXISTING_POWER);
    await aicoin.mint(oldAccount.address, EXISTING_AICOIN);
    await stake.setRelease(RELEASE_POWER, RELEASE_AICOIN);

    await expect(migrate(env))
      .to.emit(migrator, "EmergencyMigrated")
      .withArgs(
        env.operationId,
        env.emailHash,
        oldAccount.address,
        newAccount.address,
        RELEASE_POWER,
        RELEASE_AICOIN,
        EXISTING_POWER + RELEASE_POWER,
        EXISTING_AICOIN + RELEASE_AICOIN,
        COMPENSATION
      );

    expect(await stake.lastOldAddr()).to.equal(oldAccount.address);
    expect(await stake.lastNode()).to.equal(node.address);
    expect(await power.balanceOf(oldAccount.address)).to.equal(0n);
    expect(await aicoin.balanceOf(oldAccount.address)).to.equal(0n);
    expect(await power.balanceOf(newAccount.address)).to.equal(
      EXISTING_POWER + RELEASE_POWER + COMPENSATION
    );
    expect(await aicoin.balanceOf(newAccount.address)).to.equal(
      EXISTING_AICOIN + RELEASE_AICOIN
    );
    expect(await power.lastCompensationTo()).to.equal(newAccount.address);
    expect(await power.lastCompensationAmount()).to.equal(COMPENSATION);
    expect(await migrator.isMigrated(env.emailHash)).to.equal(true);
  });

  it("still pays compensation for an empty wallet and rejects a replay", async function () {
    const env = await loadFixture(deployReady);
    const { migrator, power, aicoin, newAccount } = env;

    await expect(migrate(env))
      .to.emit(migrator, "EmergencyMigrated")
      .withArgs(
        env.operationId,
        env.emailHash,
        env.oldAccount.address,
        newAccount.address,
        0n,
        0n,
        0n,
        0n,
        COMPENSATION
      );

    expect(await power.balanceOf(newAccount.address)).to.equal(COMPENSATION);
    expect(await aicoin.balanceOf(newAccount.address)).to.equal(0n);
    expect(await power.balanceOf(env.oldAccount.address)).to.equal(0n);

    await expect(
      migrate(env, { operationId: ethers.id("op-2") })
    ).to.be.revertedWith("Already migrated");
    expect(await migrator.isMigrated(env.emailHash)).to.equal(true);
  });

  it("rejects an invalid migration request", async function () {
    const env = await loadFixture(deployReady);
    const { registrar, oldAccount, newAccount, other, emailHash } = env;

    await expect(migrate(env, { caller: env.owner })).to.be.revertedWith(
      "Caller is not a relayer"
    );
    await expect(migrate(env, { emailHash: ethers.ZeroHash })).to.be.revertedWith(
      "Invalid email hash"
    );
    await expect(migrate(env, { oldAddr: ethers.ZeroAddress })).to.be.revertedWith(
      "Invalid old address"
    );
    await expect(migrate(env, { newAddr: ethers.ZeroAddress })).to.be.revertedWith(
      "Invalid new address"
    );
    await expect(
      migrate(env, { oldAddr: newAccount.address, newAddr: newAccount.address })
    ).to.be.revertedWith("Same address");
    await expect(migrate(env, { deadline: 1n })).to.be.revertedWith(
      "Signature expired"
    );
    await expect(migrate(env, { scopeHash: ethers.id("other-scope") })).to.be.revertedWith(
      "Invalid scope"
    );
    await expect(migrate(env, { configEpoch: 1n })).to.be.revertedWith(
      "Invalid config epoch"
    );

    await registrar.setEmailHashToAddr(emailHash, other.address);
    await expect(migrate(env)).to.be.revertedWith("Registrar old address mismatch");
    await registrar.setEmailHashToAddr(emailHash, oldAccount.address);

    await registrar.setEmailHash(oldAccount.address, ethers.id("someone-else"));
    await expect(migrate(env)).to.be.revertedWith("Registrar email mismatch");
    await registrar.setEmailHash(oldAccount.address, emailHash);

    const tooFarAt = (await time.latest()) + 10;
    await time.setNextBlockTimestamp(tooFarAt);
    await expect(
      migrate(env, { deadline: BigInt(tooFarAt + VALIDITY + 1) })
    ).to.be.revertedWith("Expiry too far in future");
  });

  it("rejects a bad user, platform, or chain signature", async function () {
    const env = await loadFixture(deployReady);
    const { migrator, registrar, stake, power, aicoin, oldAccount, other, emailHash } =
      env;

    await expect(migrate(env, { userWallet: oldAccount })).to.be.revertedWith(
      "Invalid user signature"
    );
    await expect(migrate(env, { platformWallet: other })).to.be.revertedWith(
      "Invalid platform signature"
    );
    await expect(migrate(env, { chainId: 1n })).to.be.revertedWith(
      "Invalid user signature"
    );

    await migrator.setLinkedContracts(
      await registrar.getAddress(),
      await stake.getAddress(),
      await power.getAddress(),
      await aicoin.getAddress()
    );
    await expect(migrate(env, { configEpoch: 0n })).to.be.revertedWith(
      "Invalid config epoch"
    );
    await migrate(env);
    expect(await migrator.isMigrated(emailHash)).to.equal(true);
  });

  it("pauses migration and rolls back a failed unstake", async function () {
    const env = await loadFixture(deployReady);
    const { migrator, stake, emailHash } = env;

    await migrator.pause();
    await expect(migrate(env)).to.be.revertedWithCustomError(
      migrator,
      "EnforcedPause"
    );
    await migrator.unpause();

    await stake.setShouldRevert(true);
    await expect(migrate(env)).to.be.revertedWith("unstake failed");
    expect(await migrator.isMigrated(emailHash)).to.equal(false);

    await stake.setShouldRevert(false);
    await migrate(env);
    expect(await migrator.isMigrated(emailHash)).to.equal(true);
  });
});
