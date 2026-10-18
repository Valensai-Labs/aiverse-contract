import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Signer } from "ethers";
import { ethers, upgrades } from "hardhat";

const DAY = 24n * 60n * 60n;
const PERIOD = 30n * DAY;
const BASE_PRICE = 1_000_000_000n;
const SEAT_ONE_REWARD = ethers.parseEther("150000000");

async function deployFund() {
  const [owner, executor, fundWallet, buyer, buyer2, other] =
    await ethers.getSigners();
  const aicoin = await ethers.deployContract("MockPaymentToken");
  const usdc = await ethers.deployContract("MockPaymentToken");
  const minPurchase = ethers.parseEther("1");
  const tokenPrice = ethers.parseEther("2");

  const factory = await ethers.getContractFactory("AiverseFundV1_0_4");
  const aiverseFund = await upgrades.deployProxy(factory, [
    await aicoin.getAddress(),
    await usdc.getAddress(),
    minPurchase,
    tokenPrice,
  ]);

  return {
    owner,
    executor,
    fundWallet,
    buyer,
    buyer2,
    other,
    aicoin,
    usdc,
    aiverseFund,
    minPurchase,
    tokenPrice,
  };
}

async function setup(
  options: {
    t0Offset?: bigint;
    maxSeats?: bigint;
    deposit?: bigint;
  } = {}
) {
  const env = await deployFund();
  const basePrice = BASE_PRICE;
  const maxSeats = options.maxSeats ?? 20n;
  const deposit = options.deposit ?? ethers.parseEther("2000000000");
  const t0 = BigInt(await time.latest()) + (options.t0Offset ?? 40n * DAY);

  await env.aiverseFund.setFundAddress(env.fundWallet.address);
  await env.aiverseFund.setExecutorAddress(env.executor.address);
  await env.aiverseFund.setBaseSeatPriceUsdc(basePrice);
  await env.aiverseFund.setMaxSeats(maxSeats);
  await env.aiverseFund.setGlobalFirstReleaseAt(t0);

  if (deposit > 0n) {
    await env.aicoin.mint(env.owner.address, deposit);
    await env.aicoin.approve(await env.aiverseFund.getAddress(), deposit);
    await env.aiverseFund.depositAICOIN(deposit);
  }

  await env.usdc.mint(env.buyer.address, basePrice * 5n);
  await env.usdc.mint(env.buyer2.address, basePrice * 5n);

  return { ...env, basePrice, t0 };
}

async function deployReady() {
  return setup();
}

type Ready = Awaited<ReturnType<typeof setup>>;

async function paySeat(
  env: Pick<Ready, "aiverseFund">,
  caller: Signer,
  buyer: Signer,
  blockTimestamp?: bigint
) {
  const deadline = (blockTimestamp ?? BigInt(await time.latest())) + 3_600n;
  return env.aiverseFund
    .connect(caller)
    .paySeatWithPermit(buyer.address, deadline, 27, ethers.ZeroHash, ethers.ZeroHash);
}

describe("AiverseFund V1.0.4", function () {
  it("initializes the token pair and rejects invalid arguments", async function () {
    const { aiverseFund, owner, aicoin, usdc, minPurchase, tokenPrice } =
      await loadFixture(deployFund);

    expect(await aiverseFund.version()).to.equal("1.0.4");
    expect(await aiverseFund.owner()).to.equal(owner.address);
    expect(await aiverseFund.aicoin()).to.equal(await aicoin.getAddress());
    expect(await aiverseFund.usdc()).to.equal(await usdc.getAddress());
    expect(await aiverseFund.minPurchaseAmount()).to.equal(minPurchase);
    expect(await aiverseFund.price()).to.equal(tokenPrice);
    expect(await aiverseFund.GENESIS_PERIODS()).to.equal(12n);
    expect(await aiverseFund.GENESIS_BATCH_SIZE()).to.equal(10n);
    expect(await aiverseFund.GENESIS_PERIOD_DURATION()).to.equal(PERIOD);

    await expect(
      aiverseFund.initialize(
        await aicoin.getAddress(),
        await usdc.getAddress(),
        minPurchase,
        tokenPrice
      )
    ).to.be.revertedWithCustomError(aiverseFund, "InvalidInitialization");

    const factory = await ethers.getContractFactory("AiverseFundV1_0_4");
    const usdcAddr = await usdc.getAddress();
    const aicoinAddr = await aicoin.getAddress();
    await expect(
      upgrades.deployProxy(factory, [ethers.ZeroAddress, usdcAddr, 1, 1])
    ).to.be.revertedWith("Invalid AICOIN address");
    await expect(
      upgrades.deployProxy(factory, [aicoinAddr, ethers.ZeroAddress, 1, 1])
    ).to.be.revertedWith("Invalid USDC address");
    await expect(
      upgrades.deployProxy(factory, [aicoinAddr, usdcAddr, 0, 1])
    ).to.be.revertedWith("Min purchase amount must be greater than 0");
    await expect(
      upgrades.deployProxy(factory, [aicoinAddr, usdcAddr, 1, 0])
    ).to.be.revertedWith("Price must be greater than 0");
  });

  it("lets the owner configure the sale and locks price and T0 after a sale", async function () {
    const env = await loadFixture(deployReady);
    const { aiverseFund, owner, fundWallet, executor, other, basePrice, t0 } = env;
    const later = t0 + DAY;

    expect(await aiverseFund.fundAddress()).to.equal(fundWallet.address);
    expect(await aiverseFund.executorAddress()).to.equal(executor.address);
    expect(await aiverseFund.baseSeatPriceUsdc()).to.equal(basePrice);
    expect(await aiverseFund.maxSeats()).to.equal(20n);
    expect(await aiverseFund.globalFirstReleaseAt()).to.equal(t0);
    expect(await aiverseFund.currentSeatPrice()).to.equal(basePrice);

    await expect(aiverseFund.setFundAddress(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid fund address"
    );
    await expect(aiverseFund.setBaseSeatPriceUsdc(0)).to.be.revertedWith(
      "Invalid base price"
    );
    await expect(aiverseFund.setGlobalFirstReleaseAt(1)).to.be.revertedWith(
      "T0 must not be in the past"
    );
    await expect(
      aiverseFund.connect(other).setFundAddress(other.address)
    ).to.be.revertedWithCustomError(aiverseFund, "OwnableUnauthorizedAccount");
    await expect(aiverseFund.connect(other).pause()).to.be.revertedWithCustomError(
      aiverseFund,
      "OwnableUnauthorizedAccount"
    );

    await paySeat(env, owner, env.buyer);

    await expect(aiverseFund.setGlobalFirstReleaseAt(later)).to.be.revertedWith(
      "Cannot change T0 after seats sold"
    );
    await expect(aiverseFund.setBaseSeatPriceUsdc(basePrice + 1n)).to.be.revertedWith(
      "Cannot change price after seats sold"
    );
    await expect(aiverseFund.setMaxSeats(0)).to.be.revertedWith("Below seats sold");

    await expect(aiverseFund.setMaxSeats(4))
      .to.emit(aiverseFund, "MaxSeatsUpdated")
      .withArgs(20, 4);
  });

  it("deposits AICOIN and withdraws every other token", async function () {
    const { aiverseFund, owner, aicoin, usdc, other } = await loadFixture(deployFund);
    const aicoinAmount = ethers.parseEther("500");
    const usdcAmount = 25n;
    const stray = await ethers.deployContract("MockPaymentToken");

    await aicoin.mint(owner.address, aicoinAmount);
    await aicoin.approve(await aiverseFund.getAddress(), aicoinAmount);
    await expect(aiverseFund.depositAICOIN(aicoinAmount))
      .to.emit(aiverseFund, "AICOINDeposited")
      .withArgs(owner.address, aicoinAmount);
    expect(await aiverseFund.getAICOINBalance()).to.equal(aicoinAmount);

    await expect(aiverseFund.depositAICOIN(0)).to.be.revertedWith(
      "Amount must be greater than 0"
    );
    await expect(
      aiverseFund.connect(other).depositAICOIN(1)
    ).to.be.revertedWithCustomError(aiverseFund, "OwnableUnauthorizedAccount");
    await expect(aiverseFund.withdrawUSDC()).to.be.revertedWith("No USDC to withdraw");

    await usdc.mint(await aiverseFund.getAddress(), usdcAmount);
    await expect(aiverseFund.withdrawUSDC())
      .to.emit(aiverseFund, "USDCWithdrawn")
      .withArgs(owner.address, usdcAmount);
    expect(await usdc.balanceOf(owner.address)).to.equal(usdcAmount);
    expect(await aiverseFund.getUSDCBalance()).to.equal(0n);

    await expect(
      aiverseFund.emergencyWithdrawToken(ethers.ZeroAddress)
    ).to.be.revertedWith("Invalid token address");
    await expect(
      aiverseFund.emergencyWithdrawToken(await aicoin.getAddress())
    ).to.be.revertedWith("AICOIN locked: vesting claims only");

    await stray.mint(await aiverseFund.getAddress(), 9n);
    await aiverseFund.emergencyWithdrawToken(await stray.getAddress());
    expect(await stray.balanceOf(owner.address)).to.equal(9n);

    await expect(
      owner.sendTransaction({ to: await aiverseFund.getAddress(), value: 1n })
    ).to.be.revertedWith("Direct ETH transfers not allowed");
    await expect(
      owner.sendTransaction({
        to: await aiverseFund.getAddress(),
        value: 1n,
        data: "0x12345678",
      })
    ).to.be.revertedWith("Fallback not allowed");
  });

  it("reports the seat schedule, tranche remainder, and global unlock times", async function () {
    const { aiverseFund, t0 } = await loadFixture(deployReady);

    expect(await aiverseFund.aicoinTotalForSeatNo(1)).to.equal(SEAT_ONE_REWARD);
    expect(await aiverseFund.aicoinTotalForSeatNo(2)).to.equal(
      ethers.parseEther("140000000")
    );
    expect(await aiverseFund.aicoinTotalForSeatNo(3)).to.equal(
      ethers.parseEther("130000000")
    );
    expect(await aiverseFund.aicoinTotalForSeatNo(4)).to.equal(
      ethers.parseEther("110000000")
    );
    expect(await aiverseFund.aicoinTotalForSeatNo(10)).to.equal(
      ethers.parseEther("110000000")
    );
    expect(await aiverseFund.aicoinTotalForSeatNo(11)).to.equal(
      ethers.parseEther("100000000")
    );

    expect(await aiverseFund.trancheAmount(100, 0)).to.equal(8);
    expect(await aiverseFund.trancheAmount(100, 11)).to.equal(12);
    await expect(aiverseFund.trancheAmount(100, 12)).to.be.revertedWith(
      "Invalid period"
    );

    expect(await aiverseFund.globalUnlockTime(0)).to.equal(t0);
    expect(await aiverseFund.globalUnlockTime(11)).to.equal(t0 + 11n * PERIOD);
    await expect(aiverseFund.globalUnlockTime(12)).to.be.revertedWith(
      "Invalid period"
    );
  });

  it("sells seats through the owner or executor and sends USDC to the fund wallet", async function () {
    const env = await setup({ maxSeats: 2n });
    const { aiverseFund, owner, executor, fundWallet, buyer, buyer2, other, usdc, basePrice } =
      env;
    const boughtAt = BigInt((await time.latest()) + 10);
    await time.setNextBlockTimestamp(boughtAt);

    await expect(paySeat(env, executor, buyer, boughtAt))
      .to.emit(aiverseFund, "GenesisSeatPurchased")
      .withArgs(buyer.address, 1n, basePrice, SEAT_ONE_REWARD, boughtAt);

    const seat = await aiverseFund.seatOf(buyer.address);
    expect(seat.seatNo).to.equal(1n);
    expect(seat.usdcPaid).to.equal(basePrice);
    expect(seat.paidAt).to.equal(boughtAt);
    expect(await usdc.balanceOf(fundWallet.address)).to.equal(basePrice);
    expect(await aiverseFund.getUSDCBalance()).to.equal(0n);
    expect(await aiverseFund.totalUSDCReceived()).to.equal(basePrice);
    expect(await aiverseFund.totalSold()).to.equal(0n);
    expect(await aiverseFund.seatsFilled()).to.equal(1n);

    await expect(paySeat(env, other, buyer2)).to.be.revertedWith(
      "Not owner or executor"
    );
    await expect(paySeat(env, owner, buyer)).to.be.revertedWith("Already purchased");

    await paySeat(env, owner, buyer2);
    await expect(paySeat(env, owner, other)).to.be.revertedWith("Sold out");
    expect(await aiverseFund.seatsFilled()).to.equal(2n);
    expect(await usdc.balanceOf(fundWallet.address)).to.equal(basePrice * 2n);
  });

  it("rejects a purchase until the sale is fully configured", async function () {
    const env = await loadFixture(deployFund);
    const { aiverseFund, owner, buyer, aicoin } = env;
    const deadline = BigInt((await time.latest()) + 3600);

    await expect(
      aiverseFund.paySeatWithPermit(buyer.address, deadline, 27, ethers.ZeroHash, ethers.ZeroHash)
    ).to.be.revertedWith("Fund address not set");

    await aiverseFund.setFundAddress(env.fundWallet.address);
    await expect(
      aiverseFund.paySeatWithPermit(
        ethers.ZeroAddress,
        deadline,
        27,
        ethers.ZeroHash,
        ethers.ZeroHash
      )
    ).to.be.revertedWith("Invalid buyer");
    await expect(paySeat(env, owner, buyer)).to.be.revertedWith(
      "Base seat price not set"
    );

    await aiverseFund.setBaseSeatPriceUsdc(BASE_PRICE);
    await expect(
      aiverseFund.paySeatWithPermit(buyer.address, 1, 27, ethers.ZeroHash, ethers.ZeroHash)
    ).to.be.revertedWith("Permit expired");
    await expect(paySeat(env, owner, buyer)).to.be.revertedWith("Max seats not set");

    await aiverseFund.setMaxSeats(1);
    await expect(paySeat(env, owner, buyer)).to.be.revertedWith("T0 not set");

    const t0 = BigInt((await time.latest()) + 3600);
    await aiverseFund.setGlobalFirstReleaseAt(t0);
    await expect(paySeat(env, owner, buyer)).to.be.revertedWith(
      "Insufficient AICOIN in contract"
    );

    await aicoin.mint(owner.address, 1n);
    await aicoin.approve(await aiverseFund.getAddress(), 1n);
    await aiverseFund.depositAICOIN(1n);
    await expect(paySeat(env, owner, buyer)).to.be.revertedWith(
      "Insufficient AICOIN in contract"
    );
  });

  it("schedules the first claim from how early the seat was bought", async function () {
    const early = await setup();
    const beforeWindow = early.t0 - PERIOD - 1n;
    await time.setNextBlockTimestamp(beforeWindow);
    await paySeat(early, early.owner, early.buyer, beforeWindow);
    expect((await early.aiverseFund.vestingOf(early.buyer.address)).firstClaimableAt).to.equal(
      early.t0
    );

    const insideWindow = await setup();
    const within = insideWindow.t0 - PERIOD;
    await time.setNextBlockTimestamp(within);
    await paySeat(insideWindow, insideWindow.owner, insideWindow.buyer, within);
    expect(
      (await insideWindow.aiverseFund.vestingOf(insideWindow.buyer.address)).firstClaimableAt
    ).to.equal(insideWindow.t0 + PERIOD);

    const atRelease = await setup({ t0Offset: DAY });
    await time.setNextBlockTimestamp(atRelease.t0);
    await paySeat(atRelease, atRelease.owner, atRelease.buyer, atRelease.t0);
    expect(
      (await atRelease.aiverseFund.vestingOf(atRelease.buyer.address)).firstClaimableAt
    ).to.equal(atRelease.t0 + 2n * PERIOD);

    const later = await setup({ t0Offset: DAY });
    const nextPeriod = later.t0 + PERIOD;
    await time.setNextBlockTimestamp(nextPeriod);
    await paySeat(later, later.owner, later.buyer, nextPeriod);
    expect((await later.aiverseFund.vestingOf(later.buyer.address)).firstClaimableAt).to.equal(
      later.t0 + 3n * PERIOD
    );
  });

  it("releases one tranche at a time and lets the executor claim for the buyer", async function () {
    const env = await loadFixture(deployReady);
    const { aiverseFund, executor, buyer, other, aicoin, t0 } = env;
    const tranche = SEAT_ONE_REWARD / 12n;

    await paySeat(env, env.owner, buyer);
    expect(await aiverseFund.claimable(buyer.address)).to.equal(0n);
    await expect(aiverseFund.connect(buyer).claim()).to.be.revertedWith("Nothing to claim");
    await expect(aiverseFund.connect(other).claimFor(buyer.address)).to.be.revertedWith(
      "Not owner or executor"
    );
    await expect(aiverseFund.claimFor(ethers.ZeroAddress)).to.be.revertedWith("Invalid user");
    await expect(aiverseFund.connect(other).claim()).to.be.revertedWith("No vesting");

    await time.increaseTo(t0);
    expect(await aiverseFund.claimable(buyer.address)).to.equal(tranche);
    await expect(aiverseFund.connect(buyer).claim())
      .to.emit(aiverseFund, "GenesisClaimed")
      .withArgs(buyer.address, tranche);
    expect(await aicoin.balanceOf(buyer.address)).to.equal(tranche);
    expect((await aiverseFund.vestingOf(buyer.address)).claimedPeriodsCount).to.equal(1n);
    await expect(aiverseFund.connect(buyer).claim()).to.be.revertedWith("Nothing to claim");

    await time.increaseTo(t0 + 11n * PERIOD);
    await aiverseFund.connect(executor).claimFor(buyer.address);
    expect(await aicoin.balanceOf(buyer.address)).to.equal(SEAT_ONE_REWARD);
    expect((await aiverseFund.vestingOf(buyer.address)).claimedPeriodsCount).to.equal(12n);
    expect(await aiverseFund.claimable(buyer.address)).to.equal(0n);
  });

  it("pushes vesting back by one period and then enforces the bump cooldown", async function () {
    const env = await loadFixture(deployReady);
    const { aiverseFund, buyer, other, t0 } = env;
    const tranche = SEAT_ONE_REWARD / 12n;

    await paySeat(env, env.owner, buyer);
    await expect(aiverseFund.increaseVestingDelay(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid user"
    );
    await expect(aiverseFund.increaseVestingDelay(other.address)).to.be.revertedWith(
      "No vesting"
    );

    await expect(aiverseFund.increaseVestingDelay(buyer.address))
      .to.emit(aiverseFund, "VestingDelayIncreased")
      .withArgs(buyer.address, 1);
    await expect(aiverseFund.increaseVestingDelay(buyer.address)).to.be.revertedWith(
      "delay bump cooldown"
    );

    const bumpedAt = await aiverseFund.lastVestingDelayBumpAt(buyer.address);
    await time.increaseTo(bumpedAt + PERIOD);
    await aiverseFund.increaseVestingDelay(buyer.address);
    expect((await aiverseFund.vestingOf(buyer.address)).delayPeriods).to.equal(2n);

    await time.increaseTo(t0);
    expect(await aiverseFund.claimable(buyer.address)).to.equal(0n);
    await time.increaseTo(t0 + PERIOD);
    expect(await aiverseFund.claimable(buyer.address)).to.equal(0n);
    await time.increaseTo(t0 + 2n * PERIOD);
    expect(await aiverseFund.claimable(buyer.address)).to.equal(tranche);
  });

  it("raises the seat price by ten percent after every ten seats", async function () {
    const env = await setup({ maxSeats: 11n });
    const buyers = (await ethers.getSigners()).slice(0, 11);

    for (const buyer of buyers) {
      await env.usdc.mint(buyer.address, BASE_PRICE * 2n);
    }

    expect(await env.aiverseFund.currentSeatPrice()).to.equal(BASE_PRICE);
    for (let index = 0; index < 10; index++) {
      await paySeat(env, env.owner, buyers[index]);
    }

    expect(await env.aiverseFund.seatsFilled()).to.equal(10n);
    expect(await env.aiverseFund.currentSeatPrice()).to.equal((BASE_PRICE * 11n) / 10n);

    await paySeat(env, env.owner, buyers[10]);
    expect((await env.aiverseFund.seatOf(buyers[10].address)).usdcPaid).to.equal(
      (BASE_PRICE * 11n) / 10n
    );
  });

  it("pauses purchases and claims until the owner unpauses", async function () {
    const env = await loadFixture(deployReady);
    const { aiverseFund, buyer, t0 } = env;

    await aiverseFund.pause();
    await expect(paySeat(env, env.owner, buyer)).to.be.revertedWithCustomError(
      aiverseFund,
      "EnforcedPause"
    );

    await aiverseFund.unpause();
    await paySeat(env, env.owner, buyer);
    await time.setNextBlockTimestamp(t0);
    await aiverseFund.pause();
    await expect(aiverseFund.connect(buyer).claim()).to.be.revertedWithCustomError(
      aiverseFund,
      "EnforcedPause"
    );

    await aiverseFund.unpause();
    await aiverseFund.connect(buyer).claim();
    expect(await env.aicoin.balanceOf(buyer.address)).to.equal(SEAT_ONE_REWARD / 12n);
  });
});
