import {
  impersonateAccount,
  loadFixture,
  setBalance,
  time,
} from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Signer } from "ethers";
import { ethers, upgrades } from "hardhat";

const DAY = 24 * 60 * 60;
const SIGNATURE_EXPIRY = 60 * 60;
const EMERGENCY_MIGRATOR = "0x99999990a6cf1104c6a865C84f4bA42e28F99bD5";
const DAILY_MINT = ethers.parseEther("1000");
const STAKE = ethers.parseEther("100");
const USER_DAY = ethers.parseEther("760");
const NODE_DAY = ethers.parseEther("190");
const FOUNDATION_DAY = ethers.parseEther("50");

const STAKE_TYPES = {
  Stake: [
    { name: "userAddr", type: "address" },
    { name: "node", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "chainid", type: "uint256" },
    { name: "expireAt", type: "uint256" },
    { name: "executor", type: "address" },
  ],
};

const UNSTAKE_TYPES = {
  Unstake: [
    { name: "userAddr", type: "address" },
    { name: "node", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "chainid", type: "uint256" },
    { name: "expireAt", type: "uint256" },
    { name: "executor", type: "address" },
  ],
};

const CLAIM_TYPES = {
  Claim: [
    { name: "userAddr", type: "address" },
    { name: "node", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "chainid", type: "uint256" },
    { name: "expireAt", type: "uint256" },
    { name: "executor", type: "address" },
  ],
};

async function deployBase() {
  const [owner, user, userB, nodeA, nodeB, signer, foundation, executor, other] =
    await ethers.getSigners();
  const power = await ethers.deployContract("MockStakePower");
  const coin = await ethers.deployContract("MockStakeCoin");
  const nodes = await ethers.deployContract("MockNodeManager");
  await nodes.setOwner(foundation.address);
  await nodes.registerNode(nodeA.address);
  await nodes.registerNode(nodeB.address);

  const factory = await ethers.getContractFactory("StakeControllerV1_0_13");
  const controller = await upgrades.deployProxy(factory, [
    await coin.getAddress(),
    await power.getAddress(),
    await nodes.getAddress(),
  ]);

  return {
    owner,
    user,
    userB,
    nodeA,
    nodeB,
    signer,
    foundation,
    executor,
    other,
    power,
    coin,
    nodes,
    controller,
  };
}

async function deployReady() {
  const env = await deployBase();
  await env.controller.setSigner(env.signer.address);
  return env;
}

type Ready = Awaited<ReturnType<typeof deployReady>>;

async function settleNextDay(env: Ready, mintAmount = DAILY_MINT) {
  const day = BigInt(Math.floor((await time.latest()) / DAY)) + 1n;
  await env.coin.setMintAmount(day, mintAmount);
  await time.increaseTo(day * BigInt(DAY));
  await env.controller.connect(env.signer).dailySettle();
  return day;
}

async function signedStake(
  env: Ready,
  user: Signer,
  node: string,
  amount: bigint,
  caller: Signer,
  overrides: {
    nonce?: bigint;
    expireAt?: bigint;
    chainId?: bigint;
    signer?: Signer;
    executor?: string;
  } = {}
) {
  const userAddr = await user.getAddress();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const nonce = overrides.nonce ?? (await env.controller.nonces(userAddr));
  const expireAt = overrides.expireAt ?? BigInt((await time.latest()) + 600);
  const domain = {
    name: "Aiverse-Stake-Controller",
    version: "1",
    chainId,
    verifyingContract: await env.controller.getAddress(),
  };
  const signature = await (overrides.signer ?? user).signTypedData(domain, STAKE_TYPES, {
    userAddr,
    node,
    amount,
    nonce,
    chainid: overrides.chainId ?? chainId,
    expireAt,
    executor: overrides.executor ?? node,
  });

  return env.controller
    .connect(caller)
    .stakeWithSig(userAddr, node, amount, expireAt, signature);
}

async function signedUnstake(
  env: Ready,
  user: Signer,
  node: string,
  amount: bigint,
  caller: Signer
) {
  const userAddr = await user.getAddress();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const nonce = await env.controller.nonces(userAddr);
  const expireAt = BigInt((await time.latest()) + 600);
  const domain = {
    name: "Aiverse-Stake-Controller",
    version: "1",
    chainId,
    verifyingContract: await env.controller.getAddress(),
  };
  const signature = await user.signTypedData(domain, UNSTAKE_TYPES, {
    userAddr,
    node,
    amount,
    nonce,
    chainid: chainId,
    expireAt,
    executor: node,
  });

  return env.controller
    .connect(caller)
    .unstakeWithSig(userAddr, node, amount, expireAt, signature);
}

async function signedClaim(env: Ready, user: Signer, node: string, caller: Signer) {
  const userAddr = await user.getAddress();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const nonce = await env.controller.nonces(userAddr);
  const expireAt = BigInt((await time.latest()) + 600);
  const domain = {
    name: "Aiverse-Stake-Controller",
    version: "1",
    chainId,
    verifyingContract: await env.controller.getAddress(),
  };
  const signature = await user.signTypedData(domain, CLAIM_TYPES, {
    userAddr,
    node,
    nonce,
    chainid: chainId,
    expireAt,
    executor: node,
  });

  return env.controller
    .connect(caller)
    .userClaimRewardWithSig(userAddr, node, expireAt, signature);
}

describe("StakeControllerV1_0_13", function () {
  it("initializes the linked contracts and the snapshot day", async function () {
    const { controller, owner, coin, power, nodes } = await loadFixture(deployBase);

    expect(await controller.version()).to.equal("1.0.13");
    expect(await controller.owner()).to.equal(owner.address);
    expect(await controller.aicoinAddr()).to.equal(await coin.getAddress());
    expect(await controller.powerAssetAddr()).to.equal(await power.getAddress());
    expect(await controller.nodeManagerAddr()).to.equal(await nodes.getAddress());
    expect(await controller.signerAddr()).to.equal(ethers.ZeroAddress);
    expect(await controller.currentSnapshotDay()).to.equal(
      BigInt(Math.floor((await time.latest()) / DAY))
    );
    expect(await controller.SIGNATURE_EXPIRY()).to.equal(SIGNATURE_EXPIRY);
    expect(await controller.MINE_REWARD_PERCENTAGE()).to.equal(95n);
    expect(await controller.MAX_DAYS_FOR_REWARD()).to.equal(7n);
    expect(await controller.totalPower()).to.equal(0n);

    const domain = await controller.eip712Domain();
    expect(domain.name).to.equal("Aiverse-Stake-Controller");
    expect(domain.version).to.equal("1");

    await expect(
      controller.initialize(
        await coin.getAddress(),
        await power.getAddress(),
        await nodes.getAddress()
      )
    ).to.be.revertedWithCustomError(controller, "InvalidInitialization");
  });

  it("lets the owner set the daily signer", async function () {
    const { controller, signer, other } = await loadFixture(deployBase);

    await expect(controller.setSigner(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid signer address"
    );
    await controller.setSigner(signer.address);
    expect(await controller.signerAddr()).to.equal(signer.address);
    await expect(controller.connect(other).setSigner(other.address))
      .to.be.revertedWithCustomError(controller, "OwnableUnauthorizedAccount")
      .withArgs(other.address);
  });

  it("stakes and unstakes power on a node", async function () {
    const env = await loadFixture(deployReady);
    const { controller, power, user, nodeA, other } = env;
    const extra = ethers.parseEther("25");
    await power.mint(user.address, STAKE + extra);

    expect(await controller.getUserUnclaimReward(user.address, nodeA.address)).to.equal(0n);
    await expect(controller.connect(user).stake(other.address, STAKE)).to.be.revertedWith(
      "Invalid Caller"
    );
    await expect(controller.connect(user).stake(nodeA.address, 0)).to.be.revertedWith(
      "Amount must be greater than 0"
    );
    expect(await power.balanceOf(user.address)).to.equal(STAKE + extra);

    await expect(controller.connect(user).stake(nodeA.address, STAKE))
      .to.emit(controller, "Staked")
      .withArgs(user.address, nodeA.address, STAKE);
    await controller.connect(user).stake(nodeA.address, extra);

    const info = await controller.userStakeInfo(user.address, nodeA.address);
    expect(info.power).to.equal(STAKE + extra);
    expect(info.lastSettledDay).to.equal(await controller.currentSnapshotDay());
    expect(await controller.userStakedNodes(user.address, 0)).to.equal(nodeA.address);
    await expect(controller.userStakedNodes(user.address, 1)).to.be.reverted;
    expect(await controller.nodeTotalPower(nodeA.address)).to.equal(STAKE + extra);
    expect(await controller.totalPower()).to.equal(STAKE + extra);
    expect(await power.balanceOf(await controller.getAddress())).to.equal(STAKE + extra);

    await expect(controller.connect(user).unstake(nodeA.address, 0)).to.be.revertedWith(
      "Amount must be greater than 0"
    );
    await expect(
      controller.connect(user).unstake(nodeA.address, STAKE + extra + 1n)
    ).to.be.revertedWith("Insufficient staked amount");

    await expect(controller.connect(user).unstake(nodeA.address, extra))
      .to.emit(controller, "Unstaked")
      .withArgs(user.address, nodeA.address, extra);
    await controller.connect(user).unstake(nodeA.address, STAKE);

    expect((await controller.userStakeInfo(user.address, nodeA.address)).power).to.equal(0n);
    expect(await controller.isUserStakedOnNode(user.address, nodeA.address)).to.equal(true);
    expect(await controller.userStakedNodes(user.address, 0)).to.equal(nodeA.address);
    expect(await controller.totalPower()).to.equal(0n);
    expect(await power.balanceOf(user.address)).to.equal(STAKE + extra);
  });

  it("accepts a third party when the signature names the node", async function () {
    const env = await loadFixture(deployReady);
    const { controller, power, user, nodeA, executor, other } = env;
    const amount = ethers.parseEther("25");
    await power.mint(user.address, amount);

    await expect(
      controller.connect(executor).stakeWithSig(
        user.address,
        nodeA.address,
        0,
        BigInt((await time.latest()) + 600),
        "0x" + "11".repeat(65)
      )
    ).to.be.revertedWith("Invalid amount");

    await signedStake(env, user, nodeA.address, amount, executor);
    expect(await controller.nonces(user.address)).to.equal(1n);
    expect((await controller.userStakeInfo(user.address, nodeA.address)).power).to.equal(
      amount
    );
    expect(await power.balanceOf(await controller.getAddress())).to.equal(amount);

    await expect(
      signedStake(env, user, nodeA.address, amount, executor, { nonce: 0n })
    ).to.be.revertedWith("Invalid signature");
    await expect(
      signedStake(env, user, nodeA.address, amount, executor, { expireAt: 1n })
    ).to.be.revertedWith("Signature expired");
    await expect(
      signedStake(env, user, nodeA.address, amount, executor, { signer: other })
    ).to.be.revertedWith("Invalid signature");
    await expect(
      signedStake(env, user, nodeA.address, amount, executor, { chainId: 1n })
    ).to.be.revertedWith("Invalid signature");
    await expect(
      signedStake(env, user, nodeA.address, amount, executor, { executor: executor.address })
    ).to.be.revertedWith("Invalid signature");

    await expect(
      signedStake(env, other, nodeA.address, amount, executor)
    ).to.be.revertedWith("insufficient");
    expect(await controller.nonces(other.address)).to.equal(0n);

    const tooFarAt = (await time.latest()) + 10;
    await time.setNextBlockTimestamp(tooFarAt);
    await expect(
      signedStake(env, user, nodeA.address, amount, executor, {
        expireAt: BigInt(tooFarAt + SIGNATURE_EXPIRY + 1),
      })
    ).to.be.revertedWith("Expiry too far in future");

    await signedUnstake(env, user, nodeA.address, amount, executor);
    expect(await controller.nonces(user.address)).to.equal(2n);
    expect((await controller.userStakeInfo(user.address, nodeA.address)).power).to.equal(0n);
    expect(await power.balanceOf(user.address)).to.equal(amount);
  });

  it("settles a day and pays the foundation five percent", async function () {
    const env = await loadFixture(deployReady);
    const { controller, coin, signer, foundation, other } = env;

    await expect(controller.connect(other).dailySettle()).to.be.revertedWith(
      "Caller must be the signer"
    );

    const day = await settleNextDay(env);
    expect(await controller.currentSnapshotDay()).to.equal(day);
    expect(await controller.totalPowerSnapshot(day)).to.equal(0n);
    expect(await controller.rewardPerPower(day)).to.equal(0n);
    expect(await coin.mintCalls()).to.equal(1n);
    expect(await coin.claimed(foundation.address)).to.equal(FOUNDATION_DAY);
    expect(await controller.nodeTotalPowerSnapshot(day, env.nodeA.address)).to.equal(0n);

    await expect(controller.connect(signer).dailySettle()).to.be.revertedWith(
      "Already Snapshot today"
    );
  });

  it("splits mine rewards eighty to users and twenty to the node", async function () {
    const env = await loadFixture(deployReady);
    const { controller, power, coin, user, userB, nodeA, foundation, executor } = env;
    const left = ethers.parseEther("60");
    const unstakeAmount = ethers.parseEther("40");
    await power.mint(user.address, STAKE);
    await power.mint(userB.address, STAKE);

    await expect(controller.connect(user).userClaimReward(nodeA.address)).to.be.revertedWith(
      "No rewards available"
    );
    await expect(controller.connect(nodeA).nodeClaimReward()).to.be.revertedWith(
      "No rewards available"
    );
    await expect(controller.connect(user).userClaimReward(executor.address)).to.be.revertedWith(
      "Invalid Caller"
    );

    await controller.connect(user).stake(nodeA.address, STAKE);
    await controller.connect(userB).stake(nodeA.address, STAKE);
    await settleNextDay(env);

    expect(await controller.getUserUnclaimReward(user.address, nodeA.address)).to.equal(
      ethers.parseEther("380")
    );
    expect(await controller.getNodeUnclaimReward(nodeA.address)).to.equal(NODE_DAY);

    await controller.connect(user).unstake(nodeA.address, unstakeAmount);
    expect((await controller.userStakeInfo(user.address, nodeA.address)).power).to.equal(left);
    expect(await controller.getUserUnclaimReward(user.address, nodeA.address)).to.equal(
      ethers.parseEther("380")
    );

    await settleNextDay(env);
    expect(await controller.getUserUnclaimReward(user.address, nodeA.address)).to.equal(
      ethers.parseEther("665")
    );
    expect(await controller.getUserUnclaimReward(userB.address, nodeA.address)).to.equal(
      ethers.parseEther("855")
    );

    await expect(controller.connect(user).userClaimReward(nodeA.address))
      .to.emit(controller, "UserClaimReward")
      .withArgs(user.address, nodeA.address, ethers.parseEther("665"));
    await expect(controller.connect(user).userClaimReward(nodeA.address)).to.be.revertedWith(
      "No rewards available"
    );

    await expect(signedClaim(env, userB, nodeA.address, executor))
      .to.emit(controller, "UserClaimReward")
      .withArgs(userB.address, nodeA.address, ethers.parseEther("855"));

    await expect(controller.connect(nodeA).nodeClaimReward())
      .to.emit(controller, "NodeClaimReward")
      .withArgs(nodeA.address, NODE_DAY * 2n);
    await expect(controller.connect(nodeA).nodeClaimReward()).to.be.revertedWith(
      "No rewards available"
    );

    expect(await coin.claimed(user.address)).to.equal(ethers.parseEther("665"));
    expect(await coin.claimed(userB.address)).to.equal(ethers.parseEther("855"));
    expect(await coin.claimed(nodeA.address)).to.equal(NODE_DAY * 2n);
    expect(await coin.claimed(foundation.address)).to.equal(FOUNDATION_DAY * 2n);
  });

  it("pays only the latest seven snapshot days", async function () {
    const env = await loadFixture(deployReady);
    const { controller, power, user, nodeA } = env;
    await power.mint(user.address, STAKE);
    await controller.connect(user).stake(nodeA.address, STAKE);

    await settleNextDay(env);
    expect(await controller.getUserUnclaimReward(user.address, nodeA.address)).to.equal(
      USER_DAY
    );

    for (let i = 0; i < 7; i++) {
      await settleNextDay(env);
    }

    expect(await controller.getUserUnclaimReward(user.address, nodeA.address)).to.equal(
      USER_DAY * 7n
    );
    expect(await controller.getNodeUnclaimReward(nodeA.address)).to.equal(NODE_DAY * 7n);
  });

  it("lets the emergency migrator unstake and claim while paused", async function () {
    const env = await loadFixture(deployReady);
    const { controller, power, coin, user, nodeA, nodeB, other } = env;
    const second = ethers.parseEther("10");
    await power.mint(user.address, STAKE + second);
    await controller.connect(user).stake(nodeA.address, STAKE);
    await settleNextDay(env);
    await controller.connect(user).stake(nodeB.address, second);

    await expect(
      controller.connect(other).emergencyUnstakeAndClaimAll(user.address, nodeA.address)
    ).to.be.revertedWith("Caller is not emergency migrator");

    await impersonateAccount(EMERGENCY_MIGRATOR);
    await setBalance(EMERGENCY_MIGRATOR, ethers.parseEther("1"));
    const migrator = await ethers.getSigner(EMERGENCY_MIGRATOR);

    await controller.pause();
    await expect(
      controller.connect(migrator).emergencyUnstakeAndClaimAll(ethers.ZeroAddress, nodeA.address)
    ).to.be.revertedWith("Invalid address");
    await expect(
      controller.connect(migrator).emergencyUnstakeAndClaimAll(user.address, other.address)
    ).to.be.revertedWith("Invalid Caller");

    await expect(
      controller.connect(migrator).emergencyUnstakeAndClaimAll(user.address, nodeA.address)
    )
      .to.emit(controller, "Unstaked")
      .withArgs(user.address, nodeA.address, STAKE)
      .and.to.emit(controller, "UserClaimReward")
      .withArgs(user.address, nodeA.address, USER_DAY);

    expect(await power.balanceOf(user.address)).to.equal(STAKE);
    expect(await coin.claimed(user.address)).to.equal(USER_DAY);
    expect((await controller.userStakeInfo(user.address, nodeA.address)).power).to.equal(0n);
    expect(await controller.isUserStakedOnNode(user.address, nodeA.address)).to.equal(false);
    expect((await controller.userStakeInfo(user.address, nodeB.address)).power).to.equal(second);
    expect(await controller.isUserStakedOnNode(user.address, nodeB.address)).to.equal(true);
    await expect(controller.userStakedNodes(user.address, 0)).to.be.reverted;
    expect(await controller.totalPower()).to.equal(second);
    expect(await controller.nodeTotalPower(nodeA.address)).to.equal(0n);
    expect(await controller.paused()).to.equal(true);
  });

  it("pauses staking, claims, and settlement", async function () {
    const env = await loadFixture(deployReady);
    const { controller, power, user, nodeA, other, signer } = env;
    await power.mint(user.address, STAKE);
    await controller.connect(user).stake(nodeA.address, STAKE);

    await controller.pause();
    await expect(controller.connect(user).stake(nodeA.address, 1n)).to.be.revertedWithCustomError(
      controller,
      "EnforcedPause"
    );
    await expect(controller.connect(user).unstake(nodeA.address, 1n)).to.be.revertedWithCustomError(
      controller,
      "EnforcedPause"
    );
    await expect(
      controller.connect(user).userClaimReward(nodeA.address)
    ).to.be.revertedWithCustomError(controller, "EnforcedPause");
    await expect(controller.connect(nodeA).nodeClaimReward()).to.be.revertedWithCustomError(
      controller,
      "EnforcedPause"
    );
    await expect(controller.connect(env.signer).dailySettle()).to.be.revertedWithCustomError(
      controller,
      "EnforcedPause"
    );
    await controller.setSigner(signer.address);
    await expect(controller.connect(other).unpause())
      .to.be.revertedWithCustomError(controller, "OwnableUnauthorizedAccount")
      .withArgs(other.address);

    await controller.unpause();
    await controller.connect(user).unstake(nodeA.address, STAKE);
    expect(await power.balanceOf(user.address)).to.equal(STAKE);
  });
});
