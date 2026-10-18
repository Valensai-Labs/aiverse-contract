import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

const AMOUNT = 10_000_000n;
const MIN_DEPOSIT = 1_000_000n;
const MAX_DEPOSIT = 1_000_000_000n;
const PRODUCT = 3n;
const GIFT = ethers.parseEther("60");

async function deployTopUp() {
  const [owner, platform, treasury, payer, host, nextOwner, other] =
    await ethers.getSigners();
  const usdc = await ethers.deployContract("MockPaymentToken");
  const powerAsset = await ethers.deployContract("MockPowerAsset");
  const factory = await ethers.getContractFactory("AiverseTopUpV1_0_2");
  const topUp = await upgrades.deployProxy(
    factory,
    [owner.address, await usdc.getAddress(), treasury.address, platform.address],
    { kind: "uups" }
  );
  await usdc.mint(payer.address, MAX_DEPOSIT * 10n);

  return {
    owner,
    platform,
    treasury,
    payer,
    host,
    nextOwner,
    other,
    usdc,
    powerAsset,
    topUp,
    factory,
  };
}

async function deployReady() {
  const env = await deployTopUp();
  await env.topUp.setMinDeposit(MIN_DEPOSIT);
  await env.topUp.setMaxDeposit(MAX_DEPOSIT);
  return env;
}

type Ready = Awaited<ReturnType<typeof deployReady>>;

async function depositWithPermit(
  env: Ready,
  overrides: {
    owner?: string;
    amount?: bigint;
    deadline?: bigint;
    productType?: bigint;
    paymentId?: string;
    caller?: Ready["platform"];
  } = {}
) {
  const owner = overrides.owner ?? env.payer.address;
  const amount = overrides.amount ?? AMOUNT;
  const deadline = overrides.deadline ?? BigInt((await time.latest()) + 3_600);
  const productType = overrides.productType ?? PRODUCT;
  const paymentId =
    overrides.paymentId ??
    (await env.topUp.computePaymentId(owner, amount, deadline, productType));

  return env.topUp
    .connect(overrides.caller ?? env.platform)
    .depositWithPermit(
      paymentId,
      owner,
      amount,
      deadline,
      productType,
      27,
      ethers.ZeroHash,
      ethers.ZeroHash
    );
}

async function depositWithGrant(
  env: Ready,
  giftAmount: bigint,
  overrides: {
    amount?: bigint;
    deadline?: bigint;
    productType?: bigint;
    paymentId?: string;
  } = {}
) {
  const amount = overrides.amount ?? AMOUNT;
  const deadline = overrides.deadline ?? BigInt((await time.latest()) + 3_600);
  const productType = overrides.productType ?? PRODUCT;
  const paymentId =
    overrides.paymentId ??
    (await env.topUp.computePaymentIdWithGrant(
      env.payer.address,
      amount,
      deadline,
      productType,
      giftAmount
    ));

  return env.topUp
    .connect(env.platform)
    .depositWithPermitAndGrant(
      paymentId,
      env.payer.address,
      amount,
      deadline,
      productType,
      giftAmount,
      27,
      ethers.ZeroHash,
      ethers.ZeroHash
    );
}

async function depositWithAuthorization(
  env: Ready,
  overrides: {
    from?: string;
    to?: string;
    hostOrderId?: string;
    amount?: bigint;
    validAfter?: bigint;
    validBefore?: bigint;
    productType?: bigint;
    paymentId?: string;
    caller?: Ready["platform"];
  } = {}
) {
  const from = overrides.from ?? env.payer.address;
  const to = overrides.to ?? env.host.address;
  const hostOrderId = overrides.hostOrderId ?? ethers.id("order-1");
  const amount = overrides.amount ?? AMOUNT;
  const validAfter = overrides.validAfter ?? 0n;
  const validBefore =
    overrides.validBefore ?? BigInt((await time.latest()) + 3_600);
  const productType = overrides.productType ?? PRODUCT;
  const paymentId =
    overrides.paymentId ??
    (await env.topUp.computePaymentIdWithAuthorization(
      from,
      to,
      hostOrderId,
      amount,
      validAfter,
      validBefore,
      productType
    ));

  return env.topUp.connect(overrides.caller ?? env.platform).depositWithAuthorization({
    paymentId,
    from,
    to,
    hostOrderId,
    amount,
    validAfter,
    validBefore,
    productType,
    v: 27,
    r: ethers.ZeroHash,
    s: ethers.ZeroHash,
  });
}

describe("AiverseTopUp V1.0.2", function () {
  it("initializes the platform treasury and rejects a second initialization", async function () {
    const { topUp, owner, platform, treasury, usdc, factory } =
      await loadFixture(deployTopUp);

    expect(await topUp.version()).to.equal("1.0.2");
    expect(await topUp.owner()).to.equal(owner.address);
    expect(await topUp.treasury()).to.equal(treasury.address);
    expect(await topUp.usdc()).to.equal(await usdc.getAddress());
    expect(await topUp.isPlatform(platform.address)).to.equal(true);
    expect(await topUp.minDeposit()).to.equal(0n);
    expect(await topUp.maxDeposit()).to.equal(0n);

    await expect(
      topUp.initialize(
        owner.address,
        await usdc.getAddress(),
        treasury.address,
        platform.address
      )
    ).to.be.revertedWithCustomError(topUp, "InvalidInitialization");

    const usdcAddr = await usdc.getAddress();
    await expect(
      upgrades.deployProxy(
        factory,
        [ethers.ZeroAddress, usdcAddr, treasury.address, platform.address],
        { kind: "uups" }
      )
    ).to.be.revertedWithCustomError(topUp, "ZeroAddress");
    await expect(
      upgrades.deployProxy(
        factory,
        [owner.address, ethers.ZeroAddress, treasury.address, platform.address],
        { kind: "uups" }
      )
    ).to.be.revertedWithCustomError(topUp, "ZeroAddress");
  });

  it("hands ownership over in two steps and lets only the owner upgrade", async function () {
    const { topUp, owner, nextOwner, other, treasury } = await loadFixture(deployTopUp);

    await topUp.transferOwnership(nextOwner.address);
    expect(await topUp.owner()).to.equal(owner.address);
    expect(await topUp.pendingOwner()).to.equal(nextOwner.address);
    await expect(topUp.connect(other).acceptOwnership()).to.be.revertedWithCustomError(
      topUp,
      "OwnableUnauthorizedAccount"
    );

    await topUp.connect(nextOwner).acceptOwnership();
    expect(await topUp.owner()).to.equal(nextOwner.address);
    expect(await topUp.pendingOwner()).to.equal(ethers.ZeroAddress);
    await expect(topUp.connect(owner).pause()).to.be.revertedWithCustomError(
      topUp,
      "OwnableUnauthorizedAccount"
    );

    const nextImplementation = await ethers.deployContract("AiverseTopUpV1_0_2");
    await expect(
      topUp.connect(other).upgradeToAndCall(await nextImplementation.getAddress(), "0x")
    ).to.be.revertedWithCustomError(topUp, "OwnableUnauthorizedAccount");
    await topUp
      .connect(nextOwner)
      .upgradeToAndCall(await nextImplementation.getAddress(), "0x");

    expect(await topUp.version()).to.equal("1.0.2");
    expect(await topUp.treasury()).to.equal(treasury.address);
  });

  it("lets the owner configure bounds, callers, and the USDC token", async function () {
    const { topUp, platform, treasury, other, usdc, powerAsset } =
      await loadFixture(deployTopUp);
    const nextUsdc = await ethers.deployContract("MockPaymentToken");
    const stuck = 5n;

    await expect(topUp.setTreasury(other.address))
      .to.emit(topUp, "TreasuryUpdated")
      .withArgs(treasury.address, other.address);
    await expect(topUp.setPlatform(other.address, true))
      .to.emit(topUp, "PlatformCallerUpdated")
      .withArgs(other.address, true);
    await topUp.setPlatform(platform.address, false);
    expect(await topUp.isPlatform(platform.address)).to.equal(false);
    await expect(topUp.setMinDeposit(MIN_DEPOSIT))
      .to.emit(topUp, "MinDepositUpdated")
      .withArgs(0, MIN_DEPOSIT);
    await expect(topUp.setMaxDeposit(MAX_DEPOSIT))
      .to.emit(topUp, "MaxDepositUpdated")
      .withArgs(0, MAX_DEPOSIT);
    await expect(topUp.setPowerAsset(await powerAsset.getAddress()))
      .to.emit(topUp, "PowerAssetUpdated")
      .withArgs(ethers.ZeroAddress, await powerAsset.getAddress());
    await expect(topUp.setMaxGiftAmount(GIFT))
      .to.emit(topUp, "MaxGiftAmountUpdated")
      .withArgs(0, GIFT);

    await expect(topUp.setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      topUp,
      "ZeroAddress"
    );
    await expect(
      topUp.setPlatform(ethers.ZeroAddress, true)
    ).to.be.revertedWithCustomError(topUp, "ZeroAddress");
    await expect(topUp.setUsdc(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      topUp,
      "ZeroAddress"
    );
    await expect(
      topUp.connect(other).setTreasury(other.address)
    ).to.be.revertedWithCustomError(topUp, "OwnableUnauthorizedAccount");

    await usdc.mint(await topUp.getAddress(), stuck);
    await expect(topUp.setUsdc(await nextUsdc.getAddress())).to.be.revertedWithCustomError(
      topUp,
      "StuckUsdcInContract"
    );
    await topUp.rescueERC20(await usdc.getAddress(), other.address, stuck);
    expect(await usdc.balanceOf(other.address)).to.equal(stuck);
    await expect(topUp.setUsdc(await nextUsdc.getAddress()))
      .to.emit(topUp, "UsdcUpdated")
      .withArgs(await usdc.getAddress(), await nextUsdc.getAddress());

    await expect(
      topUp.rescueERC20(ethers.ZeroAddress, other.address, 1)
    ).to.be.revertedWithCustomError(topUp, "ZeroAddress");
    await expect(
      topUp.rescueERC20(await nextUsdc.getAddress(), ethers.ZeroAddress, 1)
    ).to.be.revertedWithCustomError(topUp, "ZeroAddress");
  });

  it("settles a permit deposit into the treasury", async function () {
    const env = await loadFixture(deployReady);
    const { topUp, treasury, payer, usdc, other } = env;
    const deadline = BigInt((await time.latest()) + 3_600);
    const paymentId = await topUp.computePaymentId(
      payer.address,
      AMOUNT,
      deadline,
      PRODUCT
    );

    await expect(
      depositWithPermit(env, { caller: other, deadline, paymentId })
    ).to.be.revertedWithCustomError(topUp, "NotPlatform");
    await expect(
      depositWithPermit(env, { paymentId: ethers.id("wrong"), deadline })
    ).to.be.revertedWithCustomError(topUp, "PaymentIdMismatch");

    await expect(depositWithPermit(env, { deadline, paymentId }))
      .to.emit(topUp, "UsdcDepositSettled")
      .withArgs(
        paymentId,
        payer.address,
        treasury.address,
        await usdc.getAddress(),
        AMOUNT,
        deadline,
        PRODUCT
      );

    expect(await usdc.balanceOf(treasury.address)).to.equal(AMOUNT);
    expect(await usdc.balanceOf(await topUp.getAddress())).to.equal(0n);
    expect(await topUp.usedPaymentId(paymentId)).to.equal(true);
    await expect(depositWithPermit(env, { deadline, paymentId })).to.be.revertedWithCustomError(
      topUp,
      "PaymentIdAlreadyUsed"
    );
  });

  it("accepts the minimum and maximum, and an uncapped deposit when max is zero", async function () {
    const env = await loadFixture(deployReady);
    const { topUp, payer, usdc } = env;
    const huge = MAX_DEPOSIT * 5n;

    await depositWithPermit(env, { amount: MIN_DEPOSIT, productType: 1n });
    await depositWithPermit(env, { amount: MAX_DEPOSIT, productType: 2n });
    await expect(
      depositWithPermit(env, { amount: MIN_DEPOSIT - 1n, productType: 3n })
    ).to.be.revertedWithCustomError(topUp, "BelowMinDeposit");
    await expect(
      depositWithPermit(env, { amount: MAX_DEPOSIT + 1n, productType: 4n })
    ).to.be.revertedWithCustomError(topUp, "AboveMaxDeposit");
    await expect(
      depositWithPermit(env, { amount: 0n, productType: 5n })
    ).to.be.revertedWithCustomError(topUp, "InvalidAmount");
    await expect(
      depositWithPermit(env, { owner: ethers.ZeroAddress, productType: 6n })
    ).to.be.revertedWithCustomError(topUp, "ZeroAddress");

    await expect(
      depositWithPermit(env, { deadline: 1n, productType: 7n })
    ).to.be.revertedWithCustomError(topUp, "PermitExpired");

    const atDeadline = BigInt((await time.latest()) + 10);
    await time.setNextBlockTimestamp(atDeadline);
    await depositWithPermit(env, { deadline: atDeadline, productType: 8n });

    await usdc.mint(payer.address, huge);
    await topUp.setMaxDeposit(0);
    await depositWithPermit(env, { amount: huge, productType: 9n });
    expect(await usdc.balanceOf(env.treasury.address)).to.equal(
      MIN_DEPOSIT + MAX_DEPOSIT + AMOUNT + huge
    );
  });

  it("skips permit when allowance exists and does not keep a failed pull", async function () {
    const env = await loadFixture(deployReady);
    const { topUp, payer, usdc } = env;
    const deadline = BigInt((await time.latest()) + 3_600);

    await usdc.setPermitShouldRevert(true);
    await usdc.connect(payer).approve(await topUp.getAddress(), AMOUNT);
    await depositWithPermit(env, { deadline, productType: 1n });
    expect(await usdc.balanceOf(env.treasury.address)).to.equal(AMOUNT);

    const failedDeadline = deadline + 1n;
    const failedId = await topUp.computePaymentId(
      payer.address,
      AMOUNT,
      failedDeadline,
      2n
    );
    await expect(
      depositWithPermit(env, { deadline: failedDeadline, productType: 2n })
    ).to.be.revertedWith("insufficient allowance");
    expect(await topUp.usedPaymentId(failedId)).to.equal(false);

    await usdc.connect(payer).approve(await topUp.getAddress(), AMOUNT);
    await depositWithPermit(env, { deadline: failedDeadline, productType: 2n });
    expect(await topUp.usedPaymentId(failedId)).to.equal(true);
  });

  it("grants a pass bonus atomically and rejects a gift outside the cap", async function () {
    const env = await loadFixture(deployReady);
    const { topUp, payer, powerAsset, treasury, usdc } = env;

    await expect(depositWithGrant(env, GIFT, { productType: 1n })).to.be.revertedWithCustomError(
      topUp,
      "AboveMaxGift"
    );
    await topUp.setMaxGiftAmount(GIFT);
    await expect(depositWithGrant(env, GIFT + 1n, { productType: 2n })).to.be.revertedWithCustomError(
      topUp,
      "AboveMaxGift"
    );
    await expect(depositWithGrant(env, GIFT, { productType: 3n })).to.be.revertedWithCustomError(
      topUp,
      "PowerAssetNotSet"
    );

    const plainId = await topUp.computePaymentId(
      payer.address,
      AMOUNT,
      BigInt((await time.latest()) + 3_600),
      4n
    );
    await expect(
      depositWithGrant(env, 0n, { productType: 4n, paymentId: plainId })
    ).to.be.revertedWithCustomError(topUp, "PaymentIdMismatch");
    await depositWithGrant(env, 0n, { productType: 4n });
    expect(await powerAsset.passBonusMints()).to.equal(0n);

    await topUp.setPowerAsset(await powerAsset.getAddress());
    const deadline = BigInt((await time.latest()) + 3_600);
    const paymentId = await topUp.computePaymentIdWithGrant(
      payer.address,
      AMOUNT,
      deadline,
      5n,
      GIFT
    );
    await expect(depositWithGrant(env, GIFT, { deadline, productType: 5n }))
      .to.emit(topUp, "PassBonusGranted")
      .withArgs(paymentId, payer.address, GIFT);

    expect(await powerAsset.lastPassBonusUser()).to.equal(payer.address);
    expect(await powerAsset.lastPassBonusAmount()).to.equal(GIFT);
    expect(await usdc.balanceOf(treasury.address)).to.equal(AMOUNT * 2n);
  });

  it("forwards an authorized deposit to the host", async function () {
    const env = await loadFixture(deployReady);
    const { topUp, payer, host, other, usdc } = env;
    const hostOrderId = ethers.id("order-1");
    const validBefore = BigInt((await time.latest()) + 3_600);
    const paymentId = await topUp.computePaymentIdWithAuthorization(
      payer.address,
      host.address,
      hostOrderId,
      AMOUNT,
      0n,
      validBefore,
      PRODUCT
    );

    await expect(
      depositWithAuthorization(env, { caller: other, validBefore, paymentId })
    ).to.be.revertedWithCustomError(topUp, "NotPlatform");
    await expect(
      depositWithAuthorization(env, { to: await topUp.getAddress(), validBefore })
    ).to.be.revertedWithCustomError(topUp, "ZeroAddress");
    await expect(
      depositWithAuthorization(env, { hostOrderId: ethers.ZeroHash, validBefore })
    ).to.be.revertedWithCustomError(topUp, "ZeroHostOrderId");
    await expect(
      depositWithAuthorization(env, {
        to: other.address,
        validBefore,
        paymentId,
      })
    ).to.be.revertedWithCustomError(topUp, "PaymentIdMismatch");

    const tooEarly = BigInt((await time.latest()) + 20);
    await time.setNextBlockTimestamp(tooEarly);
    await expect(
      depositWithAuthorization(env, {
        validAfter: tooEarly,
        validBefore: tooEarly + 100n,
        hostOrderId: ethers.id("early"),
      })
    ).to.be.revertedWithCustomError(topUp, "AuthorizationNotYetValid");

    const expiredAt = tooEarly + 30n;
    await time.setNextBlockTimestamp(expiredAt);
    await expect(
      depositWithAuthorization(env, {
        validAfter: 0n,
        validBefore: expiredAt,
        hostOrderId: ethers.id("expired"),
      })
    ).to.be.revertedWithCustomError(topUp, "PermitExpired");

    await expect(
      depositWithAuthorization(env, { validBefore, paymentId, hostOrderId })
    )
      .to.emit(topUp, "UsdcAuthorizationSettled")
      .withArgs(
        paymentId,
        payer.address,
        host.address,
        hostOrderId,
        await usdc.getAddress(),
        AMOUNT,
        0n,
        validBefore,
        PRODUCT
      );

    expect(await usdc.balanceOf(host.address)).to.equal(AMOUNT);
    expect(await usdc.balanceOf(await topUp.getAddress())).to.equal(0n);
    expect(await usdc.authorizationUsed(paymentId)).to.equal(true);
    expect(await topUp.usedPaymentId(paymentId)).to.equal(true);
    await expect(
      depositWithAuthorization(env, { validBefore, paymentId, hostOrderId })
    ).to.be.revertedWithCustomError(topUp, "PaymentIdAlreadyUsed");
  });

  it("pauses every deposit path and rejects direct ETH", async function () {
    const env = await loadFixture(deployReady);
    const { topUp, owner } = env;
    const deadline = BigInt((await time.latest()) + 3_600);

    await topUp.pause();
    await expect(
      depositWithPermit(env, { deadline, productType: 1n })
    ).to.be.revertedWithCustomError(topUp, "EnforcedPause");
    await expect(
      depositWithGrant(env, 0n, { deadline, productType: 2n })
    ).to.be.revertedWithCustomError(topUp, "EnforcedPause");
    await expect(depositWithAuthorization(env)).to.be.revertedWithCustomError(
      topUp,
      "EnforcedPause"
    );

    await topUp.unpause();
    await depositWithPermit(env, { deadline, productType: 1n });
    expect(await env.usdc.balanceOf(env.treasury.address)).to.equal(AMOUNT);

    await expect(
      owner.sendTransaction({ to: await topUp.getAddress(), value: 1n })
    ).to.be.revertedWith("Direct ETH transfers not allowed");
    await expect(
      owner.sendTransaction({
        to: await topUp.getAddress(),
        value: 1n,
        data: "0x12345678",
      })
    ).to.be.revertedWith("Fallback not allowed");
  });
});
