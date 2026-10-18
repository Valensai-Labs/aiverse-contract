import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Signer } from "ethers";
import { ethers, upgrades } from "hardhat";

const SIGNATURE_EXPIRY = 24 * 60 * 60;
const WEEK_SECONDS = 7 * 24 * 60 * 60;
const WEEK_EPOCH = 1759708800n;
const AMOUNT = ethers.parseEther("10");

const CHECK_IN_TYPES = {
  WeeklyCheckIn: [
    { name: "userAddr", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "week", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "chainid", type: "uint256" },
    { name: "expireAt", type: "uint256" },
  ],
};

async function deployBase() {
  const [owner, foundation, nodeSigner, relayerNode, user, other] =
    await ethers.getSigners();
  const nodeManager = await ethers.deployContract("MockNodeManager");
  const registrar = await ethers.deployContract("MockAccountRegistrar");
  const powerAsset = await ethers.deployContract("MockPowerAsset");
  await nodeManager.setNode(relayerNode.address, true);
  await nodeManager.setValidNodeSigner(
    relayerNode.address,
    nodeSigner.address,
    true
  );

  const factory = await ethers.getContractFactory("CheckInManagerV1_0_7");
  const manager = await upgrades.deployProxy(factory, [
    await nodeManager.getAddress(),
    await registrar.getAddress(),
    await powerAsset.getAddress(),
  ]);

  return {
    owner,
    foundation,
    nodeSigner,
    relayerNode,
    user,
    other,
    nodeManager,
    registrar,
    powerAsset,
    manager,
  };
}

async function deployReady() {
  const env = await deployBase();
  await env.manager.setFoundationSigner(env.foundation.address);
  await env.registrar.setEmailHash(env.user.address, ethers.id("alice@example.com"));
  return env;
}

type Ready = Awaited<ReturnType<typeof deployReady>>;

async function signCheckIn(
  env: Pick<Ready, "manager" | "foundation">,
  user: Signer,
  amount: bigint,
  week: bigint,
  overrides: {
    nonce?: bigint;
    expireAt?: bigint;
    chainId?: bigint;
    userWallet?: Signer;
    foundationWallet?: Signer;
  } = {}
) {
  const userAddr = await user.getAddress();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const nonce = overrides.nonce ?? (await env.manager.nonces(userAddr));
  const expireAt = overrides.expireAt ?? BigInt((await time.latest()) + 60 * 60);
  const message = {
    userAddr,
    amount,
    week,
    nonce,
    chainid: overrides.chainId ?? chainId,
    expireAt,
  };
  const domain = {
    name: "Aiverse-CheckIn-Manager",
    version: "1",
    chainId,
    verifyingContract: await env.manager.getAddress(),
  };
  const userWallet = overrides.userWallet ?? user;
  const foundationWallet = overrides.foundationWallet ?? env.foundation;

  return {
    userAddr,
    expireAt,
    userSig: await userWallet.signTypedData(domain, CHECK_IN_TYPES, message),
    foundationSig: await foundationWallet.signTypedData(
      domain,
      CHECK_IN_TYPES,
      message
    ),
  };
}

async function checkIn(
  env: Ready,
  user: Signer,
  week: bigint,
  overrides: Parameters<typeof signCheckIn>[4] & {
    amount?: bigint;
    caller?: Signer;
  } = {}
) {
  const amount = overrides.amount ?? AMOUNT;
  const signed = await signCheckIn(env, user, amount, week, overrides);
  return env.manager
    .connect(overrides.caller ?? env.nodeSigner)
    .checkInWeekly(
      signed.userAddr,
      env.relayerNode.address,
      amount,
      week,
      signed.expireAt,
      signed.userSig,
      signed.foundationSig
    );
}

async function checkInSelf(
  env: Ready,
  user: Signer,
  week: bigint,
  overrides: Parameters<typeof signCheckIn>[4] & {
    amount?: bigint;
    relayer?: string;
  } = {}
) {
  const amount = overrides.amount ?? AMOUNT;
  const signed = await signCheckIn(env, user, amount, week, overrides);
  return env.manager
    .connect(user)
    .checkInWeeklySelf(
      overrides.relayer ?? env.relayerNode.address,
      amount,
      week,
      signed.expireAt,
      signed.foundationSig
    );
}

describe("CheckInManager V1.0.7", function () {
  it("initializes the week clock and its dependencies", async function () {
    const { manager, owner, nodeManager, registrar, powerAsset } =
      await loadFixture(deployBase);
    const latest = BigInt(await time.latest());

    expect(await manager.version()).to.equal("1.0.7");
    expect(await manager.owner()).to.equal(owner.address);
    expect(await manager.nodeManager()).to.equal(await nodeManager.getAddress());
    expect(await manager.accountRegistrar()).to.equal(await registrar.getAddress());
    expect(await manager.powerAsset()).to.equal(await powerAsset.getAddress());
    expect(await manager.SIGNATURE_EXPIRY()).to.equal(SIGNATURE_EXPIRY);
    expect(await manager.getCurrentWeek()).to.equal((latest - WEEK_EPOCH) / BigInt(WEEK_SECONDS));

    await expect(
      manager.initialize(
        await nodeManager.getAddress(),
        await registrar.getAddress(),
        await powerAsset.getAddress()
      )
    ).to.be.revertedWithCustomError(manager, "InvalidInitialization");
  });

  it("lets the owner set the foundation signer", async function () {
    const { manager, foundation, other } = await loadFixture(deployReady);

    expect(await manager.foundationSigner()).to.equal(foundation.address);
    await expect(
      manager.setFoundationSigner(ethers.ZeroAddress)
    ).to.be.revertedWith("Invalid foundation signer");
    await expect(
      manager.connect(other).setFoundationSigner(other.address)
    ).to.be.revertedWithCustomError(manager, "OwnableUnauthorizedAccount");
    await expect(manager.connect(other).pause()).to.be.revertedWithCustomError(
      manager,
      "OwnableUnauthorizedAccount"
    );
  });

  it("checks in a registered user for the current week through a node signer", async function () {
    const env = await loadFixture(deployReady);
    const { manager, powerAsset, relayerNode, user } = env;
    const week = await manager.getCurrentWeek();

    await expect(checkIn(env, user, week))
      .to.emit(manager, "WeeklyCheckedIn")
      .withArgs(user.address, relayerNode.address, week, AMOUNT);

    expect(await powerAsset.lastCheckInUser()).to.equal(user.address);
    expect(await powerAsset.lastCheckInNode()).to.equal(relayerNode.address);
    expect(await powerAsset.lastCheckInAmount()).to.equal(AMOUNT);
    expect(await powerAsset.checkInRewardMints()).to.equal(1n);
    expect(await manager.nonces(user.address)).to.equal(1n);
    expect(await manager.getNonce(user.address)).to.equal(1n);
    expect(await manager.hasCheckedInThisWeek(user.address)).to.equal(true);
    expect(await manager.hasCheckedInForWeek(user.address, week)).to.equal(true);
  });

  it("accepts the previous week and rejects any other week", async function () {
    const env = await loadFixture(deployReady);
    const { manager, user } = env;
    const current = await manager.getCurrentWeek();
    expect(current).to.be.gt(1n);
    const previous = current - 1n;

    await checkIn(env, user, previous);
    expect(await manager.hasCheckedInForWeek(user.address, previous)).to.equal(true);
    expect(await manager.hasCheckedInThisWeek(user.address)).to.equal(false);

    await expect(checkIn(env, user, current - 2n)).to.be.revertedWith("Invalid week");
    await expect(checkIn(env, user, current + 1n)).to.be.revertedWith("Invalid week");
    await expect(checkIn(env, user, previous)).to.be.revertedWith(
      "Already checked-in this week"
    );

    await checkIn(env, user, current);
    expect(await manager.hasCheckedInThisWeek(user.address)).to.equal(true);
    expect(await manager.nonces(user.address)).to.equal(2n);
  });

  it("lets an unregistered user self-check and shares that week with the relay", async function () {
    const env = await loadFixture(deployReady);
    const { manager, powerAsset, relayerNode, other, registrar } = env;
    const current = await manager.getCurrentWeek();

    await expect(checkInSelf(env, other, current))
      .to.emit(manager, "WeeklyCheckedIn")
      .withArgs(other.address, relayerNode.address, current, AMOUNT);
    expect(await powerAsset.lastCheckInUser()).to.equal(other.address);
    expect(await registrar.userEmailHash(other.address)).to.equal(ethers.ZeroHash);

    await registrar.setEmailHash(other.address, ethers.id("bob@example.com"));
    await expect(checkIn(env, other, current)).to.be.revertedWith(
      "Already checked-in this week"
    );

    await checkIn(env, other, current - 1n);
    expect(await manager.nonces(other.address)).to.equal(2n);
    expect(await manager.hasCheckedInForWeek(other.address, current - 1n)).to.equal(
      true
    );
  });

  it("rejects a bad caller, an unregistered relay, and an empty check-in", async function () {
    const env = await loadFixture(deployReady);
    const { manager, nodeSigner, relayerNode, user, other } = env;
    const week = await manager.getCurrentWeek();
    const expireAt = BigInt((await time.latest()) + 3600);
    const signature = "0x" + "11".repeat(65);

    await expect(
      checkIn(env, user, week, { caller: other })
    ).to.be.revertedWith("Invalid Node Or Signer");
    await expect(
      checkInSelf(env, user, week, { relayer: other.address })
    ).to.be.revertedWith("Invalid relayer node");
    await expect(checkIn(env, other, week)).to.be.revertedWith("User not registered");

    await expect(
      manager.connect(nodeSigner).checkInWeekly(
        ethers.ZeroAddress,
        relayerNode.address,
        AMOUNT,
        week,
        expireAt,
        signature,
        signature
      )
    ).to.be.revertedWith("Invalid user address");
    await expect(
      checkIn(env, user, week, { amount: 0n })
    ).to.be.revertedWith("Invalid amount");
    await expect(
      checkInSelf(env, user, week, { amount: 0n })
    ).to.be.revertedWith("Invalid amount");
  });

  it("rejects expired signatures and expiries beyond one day", async function () {
    const env = await loadFixture(deployReady);
    const { user, manager } = env;
    const week = await manager.getCurrentWeek();
    const now = await time.latest();

    await time.setNextBlockTimestamp(now + 10);
    await expect(
      checkIn(env, user, week, { expireAt: BigInt(now + 9) })
    ).to.be.revertedWith("Signature expired");

    const next = now + 20;
    await time.setNextBlockTimestamp(next);
    await expect(
      checkIn(env, user, week, {
        expireAt: BigInt(next + SIGNATURE_EXPIRY + 1),
      })
    ).to.be.revertedWith("Expiry too far in future");
  });

  it("rejects signatures from the wrong user, foundation, nonce, chain, or week", async function () {
    const env = await loadFixture(deployReady);
    const { manager, user, other } = env;
    const current = await manager.getCurrentWeek();

    await expect(
      checkIn(env, user, current, { userWallet: other })
    ).to.be.revertedWith("Invalid user signature");
    await expect(
      checkIn(env, user, current, { foundationWallet: other })
    ).to.be.revertedWith("Invalid foundation signature");
    await expect(checkIn(env, user, current, { nonce: 1n })).to.be.revertedWith(
      "Invalid user signature"
    );
    await expect(checkIn(env, user, current, { chainId: 1n })).to.be.revertedWith(
      "Invalid user signature"
    );

    const signed = await signCheckIn(env, user, AMOUNT, current);
    await expect(
      env.manager.connect(env.nodeSigner).checkInWeekly(
        user.address,
        env.relayerNode.address,
        AMOUNT,
        current - 1n,
        signed.expireAt,
        signed.userSig,
        signed.foundationSig
      )
    ).to.be.revertedWith("Invalid user signature");
    await expect(
      checkInSelf(env, user, current, { foundationWallet: other })
    ).to.be.revertedWith("Invalid foundation signature");
  });

  it("pauses check-ins and foundation signer updates", async function () {
    const env = await loadFixture(deployReady);
    const { manager, user } = env;
    const week = await manager.getCurrentWeek();

    await manager.pause();
    await expect(checkIn(env, user, week)).to.be.revertedWithCustomError(
      manager,
      "EnforcedPause"
    );
    await expect(
      manager.setFoundationSigner(env.foundation.address)
    ).to.be.revertedWithCustomError(manager, "EnforcedPause");

    await manager.unpause();
    await expect(checkIn(env, user, week)).to.emit(manager, "WeeklyCheckedIn");
  });
});
