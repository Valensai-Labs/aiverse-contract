import {
  impersonateAccount,
  loadFixture,
  setBalance,
  time,
} from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Signer } from "ethers";
import { ethers, upgrades } from "hardhat";

const SIGNATURE_EXPIRY = 60 * 60;
const YEAR = 365 * 24 * 60 * 60;
const EMERGENCY_MIGRATOR = "0x99999990a6cf1104c6a865C84f4bA42e28F99bD5";
const NODE_REWARD = ethers.parseEther("20");
const AMOUNT = ethers.parseEther("10");

const TRANSFER_TYPES = {
  Transfer: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "chainid", type: "uint256" },
    { name: "expireAt", type: "uint256" },
    { name: "executor", type: "address" },
  ],
};

async function deployAsset() {
  const [
    owner,
    user,
    relayer,
    foundation,
    stakeController,
    registrar,
    checkIn,
    activity,
    topUp,
    executor,
    authorized,
    other,
  ] = await ethers.getSigners();

  const factory = await ethers.getContractFactory("PowerAssetV1_0_10");
  const asset = await upgrades.deployProxy(factory, ["AIHASH", "AIHASH"]);

  return {
    owner,
    user,
    relayer,
    foundation,
    stakeController,
    registrar,
    checkIn,
    activity,
    topUp,
    executor,
    authorized,
    other,
    asset,
  };
}

async function deployReady() {
  const env = await deployAsset();
  await env.asset.setAccountRegistrar(env.registrar.address);
  await env.asset.setCheckInManager(env.checkIn.address);
  await env.asset.setStakeController(env.stakeController.address);
  await env.asset.setActivityClaimManager(env.activity.address);
  await env.asset.setTopUp(env.topUp.address);
  await env.asset.setAuthorizedContract(env.authorized.address, true);
  return env;
}

type Ready = Awaited<ReturnType<typeof deployReady>>;

async function signedTransfer(
  { asset }: Pick<Ready, "asset">,
  from: Signer,
  to: string,
  amount: bigint,
  executor: Signer,
  overrides: {
    nonce?: bigint;
    expireAt?: bigint;
    chainId?: bigint;
    signer?: Signer;
    boundExecutor?: string;
  } = {}
) {
  const fromAddr = await from.getAddress();
  const executorAddr = overrides.boundExecutor ?? (await executor.getAddress());
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const nonce = overrides.nonce ?? (await asset.nonces(fromAddr));
  const expireAt = overrides.expireAt ?? BigInt((await time.latest()) + 600);
  const domain = {
    name: "Aiverse-Power-Asset",
    version: "1",
    chainId,
    verifyingContract: await asset.getAddress(),
  };
  const signature = await (overrides.signer ?? from).signTypedData(
    domain,
    TRANSFER_TYPES,
    {
      from: fromAddr,
      to,
      amount,
      nonce,
      chainid: overrides.chainId ?? chainId,
      expireAt,
      executor: executorAddr,
    }
  );

  return asset
    .connect(executor)
    .transferWithSig(fromAddr, to, amount, expireAt, signature);
}

describe("PowerAssetV1_0_10", function () {
  it("initializes the token and rejects a second init", async function () {
    const { asset, owner } = await loadFixture(deployAsset);

    expect(await asset.version()).to.equal("1.0.10");
    expect(await asset.name()).to.equal("AIHASH");
    expect(await asset.symbol()).to.equal("AIHASH");
    expect(await asset.owner()).to.equal(owner.address);
    expect(await asset.decimals()).to.equal(18);
    expect(await asset.SIGNATURE_EXPIRY()).to.equal(SIGNATURE_EXPIRY);
    expect(await asset.startTime()).to.equal(await time.latest());
    expect(await asset.totalSupply()).to.equal(0n);

    const domain = await asset.eip712Domain();
    expect(domain.name).to.equal("Aiverse-Power-Asset");
    expect(domain.version).to.equal("1");

    await expect(asset.initialize("AIHASH", "AIHASH")).to.be.revertedWithCustomError(
      asset,
      "InvalidInitialization"
    );
  });

  it("lets the owner wire the mint and transfer roles", async function () {
    const {
      asset,
      registrar,
      checkIn,
      stakeController,
      activity,
      topUp,
      authorized,
      other,
    } = await loadFixture(deployAsset);

    await expect(asset.setAccountRegistrar(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid address"
    );
    await asset.setAccountRegistrar(registrar.address);
    await asset.setCheckInManager(checkIn.address);
    await asset.setStakeController(stakeController.address);
    await asset.setActivityClaimManager(activity.address);
    await asset.setTopUp(topUp.address);
    await expect(
      asset.setAuthorizedContract(ethers.ZeroAddress, true)
    ).to.be.revertedWith("Invalid contract address");
    await asset.setAuthorizedContract(authorized.address, true);

    expect(await asset.accountRegistrar()).to.equal(registrar.address);
    expect(await asset.checkInManager()).to.equal(checkIn.address);
    expect(await asset.stakeController()).to.equal(stakeController.address);
    expect(await asset.activityClaimManager()).to.equal(activity.address);
    expect(await asset.topUp()).to.equal(topUp.address);
    expect(await asset.authorizedContracts(authorized.address)).to.equal(true);
    await expect(asset.connect(other).setStakeController(other.address))
      .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
      .withArgs(other.address);
  });

  it("mints a registration reward that halves every four years", async function () {
    const { asset, registrar, foundation, other } = await loadFixture(deployReady);

    await expect(asset.connect(other).mintRegistrationRewards(foundation.address))
      .to.be.revertedWith("Only AccountRegistrar can mint");
    await expect(
      asset.connect(registrar).mintRegistrationRewards(ethers.ZeroAddress)
    ).to.be.revertedWith("Invalid address");

    await expect(asset.connect(registrar).mintRegistrationRewards(foundation.address))
      .to.emit(asset, "Mint")
      .withArgs(foundation.address, NODE_REWARD);
    expect(await asset.balanceOf(foundation.address)).to.equal(NODE_REWARD);

    await time.increase(4 * YEAR);
    await asset.connect(registrar).mintRegistrationRewards(foundation.address);
    expect(await asset.balanceOf(foundation.address)).to.equal(NODE_REWARD + NODE_REWARD / 2n);

    await time.increase(4 * YEAR);
    await asset.connect(registrar).mintRegistrationRewards(foundation.address);
    expect(await asset.balanceOf(foundation.address)).to.equal(
      NODE_REWARD + NODE_REWARD / 2n + NODE_REWARD / 4n
    );
  });

  it("mints check-in and activity rewards to the user and the relayer", async function () {
    const { asset, checkIn, activity, user, relayer, other } =
      await loadFixture(deployReady);

    await expect(
      asset.connect(other).mintCheckInRewards(user.address, relayer.address, AMOUNT)
    ).to.be.revertedWith("Only CheckInManager can mint");
    await expect(
      asset.connect(checkIn).mintCheckInRewards(ethers.ZeroAddress, relayer.address, AMOUNT)
    ).to.be.revertedWith("Invalid address");
    await expect(
      asset.connect(checkIn).mintCheckInRewards(user.address, ethers.ZeroAddress, AMOUNT)
    ).to.be.revertedWith("Invalid address");
    await expect(
      asset.connect(checkIn).mintCheckInRewards(user.address, relayer.address, 0)
    ).to.be.revertedWith("Invalid amount");

    await expect(
      asset.connect(checkIn).mintCheckInRewards(user.address, relayer.address, AMOUNT)
    )
      .to.emit(asset, "Mint")
      .withArgs(user.address, AMOUNT)
      .and.to.emit(asset, "Mint")
      .withArgs(relayer.address, NODE_REWARD);

    await expect(
      asset.connect(other).mintActivityRewards(user.address, relayer.address, AMOUNT)
    ).to.be.revertedWith("Only ActivityClaimManager can mint");
    await expect(
      asset.connect(activity).mintActivityRewards(user.address, relayer.address, AMOUNT)
    )
      .to.emit(asset, "Mint")
      .withArgs(user.address, AMOUNT)
      .and.to.emit(asset, "Mint")
      .withArgs(relayer.address, NODE_REWARD);

    expect(await asset.balanceOf(user.address)).to.equal(AMOUNT * 2n);
    expect(await asset.balanceOf(relayer.address)).to.equal(NODE_REWARD * 2n);
  });

  it("mints a pass bonus for the exact amount", async function () {
    const { asset, topUp, user, other } = await loadFixture(deployReady);

    await expect(asset.connect(other).mintPassBonus(user.address, AMOUNT)).to.be.revertedWith(
      "Only TopUp can mint"
    );
    await expect(
      asset.connect(topUp).mintPassBonus(ethers.ZeroAddress, AMOUNT)
    ).to.be.revertedWith("Invalid address");
    await expect(asset.connect(topUp).mintPassBonus(user.address, 0)).to.be.revertedWith(
      "Invalid amount"
    );

    await expect(asset.connect(topUp).mintPassBonus(user.address, AMOUNT))
      .to.emit(asset, "Mint")
      .withArgs(user.address, AMOUNT);
    expect(await asset.balanceOf(user.address)).to.equal(AMOUNT);
  });

  it("lets a holder transfer, but transferFrom ignores allowance", async function () {
    const { asset, topUp, user, other, stakeController, authorized } =
      await loadFixture(deployReady);
    const balance = ethers.parseEther("100");
    const pull = ethers.parseEther("40");
    await asset.connect(topUp).mintPassBonus(user.address, balance);
    await asset.connect(user).approve(stakeController.address, 1n);

    await expect(
      asset.connect(user).transferFrom(user.address, other.address, pull)
    ).to.be.revertedWith("Only StakeController or authorized contracts can transfer");

    await asset.connect(stakeController).transferFrom(user.address, other.address, pull);
    expect(await asset.allowance(user.address, stakeController.address)).to.equal(1n);
    expect(await asset.balanceOf(other.address)).to.equal(pull);

    await asset.connect(authorized).transferFrom(user.address, authorized.address, AMOUNT);
    await asset.setAuthorizedContract(authorized.address, false);
    await expect(
      asset.connect(authorized).transferFrom(user.address, authorized.address, AMOUNT)
    ).to.be.revertedWith("Only StakeController or authorized contracts can transfer");

    await asset.connect(user).transfer(other.address, AMOUNT);
    expect(await asset.balanceOf(user.address)).to.equal(balance - pull - AMOUNT * 2n);
    expect(await asset.balanceOf(other.address)).to.equal(pull + AMOUNT);
  });

  it("transfers with a signature bound to the executor", async function () {
    const env = await loadFixture(deployReady);
    const { asset, topUp, user, foundation, other, executor } = env;
    const balance = ethers.parseEther("100");
    const amount = ethers.parseEther("40");
    await asset.connect(topUp).mintPassBonus(user.address, balance);

    await signedTransfer(env, user, other.address, amount, executor);
    expect(await asset.balanceOf(other.address)).to.equal(amount);
    expect(await asset.nonces(user.address)).to.equal(1n);

    await expect(
      signedTransfer(env, user, other.address, amount, executor, { nonce: 0n })
    ).to.be.revertedWith("Invalid signature");
    await expect(signedTransfer(env, user, other.address, amount, executor, { expireAt: 1n }))
      .to.be.revertedWith("Signature expired");
    await expect(
      signedTransfer(env, user, other.address, amount, executor, { signer: other })
    ).to.be.revertedWith("Invalid signature");
    await expect(
      signedTransfer(env, user, other.address, amount, executor, { chainId: 1n })
    ).to.be.revertedWith("Invalid signature");
    await expect(
      signedTransfer(env, user, other.address, amount, executor, {
        boundExecutor: other.address,
      })
    ).to.be.revertedWith("Invalid signature");

    await expect(
      signedTransfer(env, foundation, user.address, amount, executor)
    ).to.be.revertedWithCustomError(asset, "ERC20InsufficientBalance");
    expect(await asset.nonces(foundation.address)).to.equal(0n);

    const tooFarAt = (await time.latest()) + 10;
    await time.setNextBlockTimestamp(tooFarAt);
    await expect(
      signedTransfer(env, user, other.address, amount, executor, {
        expireAt: BigInt(tooFarAt + SIGNATURE_EXPIRY + 1),
      })
    ).to.be.revertedWith("Expiry too far in future");
  });

  it("lets only the emergency migrator move or mint, including while paused", async function () {
    const { asset, topUp, user, other } = await loadFixture(deployReady);
    const amount = ethers.parseEther("7");
    const compensation = ethers.parseEther("3");
    await asset.connect(topUp).mintPassBonus(user.address, amount);

    await expect(
      asset.connect(other).emergencyTransferFrom(user.address, other.address, amount)
    ).to.be.revertedWith("Caller is not emergency migrator");
    await expect(
      asset.connect(other).emergencyMintCompensation(other.address, compensation)
    ).to.be.revertedWith("Caller is not emergency migrator");

    await impersonateAccount(EMERGENCY_MIGRATOR);
    await setBalance(EMERGENCY_MIGRATOR, ethers.parseEther("1"));
    const migrator = await ethers.getSigner(EMERGENCY_MIGRATOR);

    await asset.pause();
    await asset.connect(migrator).emergencyTransferFrom(user.address, other.address, amount);
    await expect(asset.connect(migrator).emergencyMintCompensation(other.address, compensation))
      .to.emit(asset, "Mint")
      .withArgs(other.address, compensation);

    expect(await asset.balanceOf(user.address)).to.equal(0n);
    expect(await asset.balanceOf(other.address)).to.equal(amount + compensation);
    expect(await asset.paused()).to.equal(true);
  });

  it("pauses transfers, signatures, and mints", async function () {
    const env = await loadFixture(deployReady);
    const { asset, topUp, user, other, stakeController, registrar, foundation, checkIn, relayer } =
      env;
    await asset.connect(topUp).mintPassBonus(user.address, AMOUNT);

    await asset.pause();
    await expect(asset.connect(user).transfer(other.address, 1n)).to.be.revertedWithCustomError(
      asset,
      "EnforcedPause"
    );
    await expect(
      asset.connect(stakeController).transferFrom(user.address, other.address, 1n)
    ).to.be.revertedWithCustomError(asset, "EnforcedPause");
    await expect(
      signedTransfer(env, user, other.address, 1n, env.executor)
    ).to.be.revertedWithCustomError(asset, "EnforcedPause");
    await expect(
      asset.connect(registrar).mintRegistrationRewards(foundation.address)
    ).to.be.revertedWithCustomError(asset, "EnforcedPause");
    await expect(
      asset.connect(checkIn).mintCheckInRewards(user.address, relayer.address, AMOUNT)
    ).to.be.revertedWithCustomError(asset, "EnforcedPause");
    await expect(
      asset.connect(topUp).mintPassBonus(user.address, AMOUNT)
    ).to.be.revertedWithCustomError(asset, "EnforcedPause");
    await expect(asset.setAccountRegistrar(registrar.address)).to.be.revertedWithCustomError(
      asset,
      "EnforcedPause"
    );
    await expect(asset.connect(other).unpause())
      .to.be.revertedWithCustomError(asset, "OwnableUnauthorizedAccount")
      .withArgs(other.address);

    await asset.unpause();
    await asset.connect(user).transfer(other.address, AMOUNT);
    expect(await asset.balanceOf(other.address)).to.equal(AMOUNT);
  });
});
