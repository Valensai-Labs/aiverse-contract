import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

const AMOUNT = ethers.parseEther("10");
const MIN_AMOUNT = ethers.parseEther("1");
const MAX_AMOUNT = ethers.parseEther("1000");
const SIGNATURE_EXPIRY = 60 * 60;
const TOKEN_SIGNATURE = "0xabcd";

const CLAIM_TYPES = {
  Claim: [
    { name: "token", type: "address" },
    { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "paymentId", type: "bytes32" },
    { name: "productType", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "chainid", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
};

async function deployTreasury() {
  const [owner, platform, user, protocolSigner, nextOwner, other] =
    await ethers.getSigners();
  const aicoin = await ethers.deployContract("MockPaymentToken");
  const factory = await ethers.getContractFactory("AiverseTreasuryV1_0_2");
  const treasury = await upgrades.deployProxy(
    factory,
    [owner.address, await aicoin.getAddress()],
    { kind: "uups" }
  );

  return { owner, platform, user, protocolSigner, nextOwner, other, aicoin, treasury, factory };
}

async function deployReady() {
  const env = await deployTreasury();
  await env.treasury.setSigner(env.protocolSigner.address);
  await env.treasury.setPlatform(env.platform.address, true);
  await env.treasury.setMinDeposit(MIN_AMOUNT);
  await env.treasury.setMaxDeposit(MAX_AMOUNT);
  await env.treasury.setMinClaim(MIN_AMOUNT);
  await env.treasury.setMaxClaim(MAX_AMOUNT);
  await env.aicoin.mint(env.user.address, MAX_AMOUNT * 20n);
  return env;
}

type Ready = Awaited<ReturnType<typeof deployReady>>;

async function deposit(
  env: Ready,
  overrides: {
    payer?: string;
    amount?: bigint;
    deadline?: bigint;
    paymentId?: string;
    signature?: string;
    caller?: Ready["platform"];
  } = {}
) {
  const payer = overrides.payer ?? env.user.address;
  const amount = overrides.amount ?? AMOUNT;
  const deadline = overrides.deadline ?? BigInt((await time.latest()) + 600);
  const paymentId =
    overrides.paymentId ??
    (await env.treasury.computePaymentId(
      await env.treasury.OP_KIND_DEPOSIT(),
      payer,
      amount,
      deadline
    ));

  return env.treasury
    .connect(overrides.caller ?? env.platform)
    .deposit(
      paymentId,
      payer,
      amount,
      deadline,
      overrides.signature ?? TOKEN_SIGNATURE
    );
}

async function claim(
  env: Ready,
  overrides: {
    recipient?: string;
    amount?: bigint;
    deadline?: bigint;
    paymentId?: string;
    nonce?: bigint;
    chainId?: bigint;
    productType?: string;
    user?: Ready["user"];
    protocolSigner?: Ready["protocolSigner"];
    caller?: Ready["platform"];
  } = {}
) {
  const recipient = overrides.recipient ?? env.user.address;
  const amount = overrides.amount ?? AMOUNT;
  const deadline = overrides.deadline ?? BigInt((await time.latest()) + 600);
  const paymentId =
    overrides.paymentId ??
    (await env.treasury.computePaymentId(
      await env.treasury.OP_KIND_CLAIM(),
      recipient,
      amount,
      deadline
    ));
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const nonce = overrides.nonce ?? (await env.treasury.claimNonces(recipient));
  const productType = overrides.productType ?? (await env.treasury.PRODUCT_TYPE_CLAIM());
  const message = {
    token: await env.aicoin.getAddress(),
    recipient,
    amount,
    paymentId,
    productType,
    nonce,
    chainid: overrides.chainId ?? chainId,
    deadline,
  };
  const domain = {
    name: "Aiverse-Treasury",
    version: "1",
    chainId,
    verifyingContract: await env.treasury.getAddress(),
  };
  const user = overrides.user ?? env.user;
  const protocolSigner = overrides.protocolSigner ?? env.protocolSigner;

  return env.treasury.connect(overrides.caller ?? env.platform).claim(
    paymentId,
    recipient,
    amount,
    deadline,
    await user.signTypedData(domain, CLAIM_TYPES, message),
    await protocolSigner.signTypedData(domain, CLAIM_TYPES, message)
  );
}

describe("AiverseTreasury V1.0.2", function () {
  it("initializes the treasury and rejects a second initialization", async function () {
    const { treasury, owner, aicoin, user, factory } = await loadFixture(deployTreasury);
    const aicoinAddr = await aicoin.getAddress();

    expect(await treasury.version()).to.equal("1.0.2");
    expect(await treasury.owner()).to.equal(owner.address);
    expect(await treasury.aicoin()).to.equal(aicoinAddr);
    expect(await treasury.signer()).to.equal(ethers.ZeroAddress);
    expect(await treasury.minDeposit()).to.equal(0n);
    expect(await treasury.maxDeposit()).to.equal(0n);
    expect(await treasury.SIGNATURE_EXPIRY()).to.equal(SIGNATURE_EXPIRY);
    expect(await treasury.OP_KIND_DEPOSIT()).to.equal("0x01");
    expect(await treasury.OP_KIND_CLAIM()).to.equal("0x02");
    expect(await treasury.PRODUCT_TYPE_DEPOSIT()).to.equal(
      ethers.id("AICOIN_TREASURY_DEPOSIT")
    );
    expect(await treasury.PRODUCT_TYPE_CLAIM()).to.equal(
      ethers.id("AICOIN_TREASURY_CLAIM")
    );

    const domain = await treasury.eip712Domain();
    expect(domain.name).to.equal("Aiverse-Treasury");
    expect(domain.version).to.equal("1");

    const deadline = BigInt((await time.latest()) + 600);
    const depositId = await treasury.computePaymentId(
      await treasury.OP_KIND_DEPOSIT(),
      user.address,
      AMOUNT,
      deadline
    );
    const claimId = await treasury.computePaymentId(
      await treasury.OP_KIND_CLAIM(),
      user.address,
      AMOUNT,
      deadline
    );
    expect(depositId).to.not.equal(claimId);
    await expect(
      treasury.computePaymentId("0x03", user.address, AMOUNT, deadline)
    ).to.be.revertedWithCustomError(treasury, "InvalidKind");

    await expect(
      treasury.initialize(owner.address, aicoinAddr)
    ).to.be.revertedWithCustomError(treasury, "InvalidInitialization");
    await expect(
      upgrades.deployProxy(factory, [ethers.ZeroAddress, aicoinAddr], { kind: "uups" })
    ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
    await expect(
      upgrades.deployProxy(factory, [owner.address, ethers.ZeroAddress], { kind: "uups" })
    ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
  });

  it("hands ownership over in two steps and lets only the owner upgrade", async function () {
    const { treasury, owner, nextOwner, other, aicoin } = await loadFixture(deployTreasury);

    await treasury.transferOwnership(nextOwner.address);
    expect(await treasury.owner()).to.equal(owner.address);
    expect(await treasury.pendingOwner()).to.equal(nextOwner.address);
    await expect(treasury.connect(other).acceptOwnership()).to.be.revertedWithCustomError(
      treasury,
      "OwnableUnauthorizedAccount"
    );

    await treasury.connect(nextOwner).acceptOwnership();
    expect(await treasury.owner()).to.equal(nextOwner.address);
    await expect(treasury.connect(owner).pause()).to.be.revertedWithCustomError(
      treasury,
      "OwnableUnauthorizedAccount"
    );

    const nextImplementation = await ethers.deployContract("AiverseTreasuryV1_0_2");
    await expect(
      treasury.connect(other).upgradeToAndCall(await nextImplementation.getAddress(), "0x")
    ).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    await treasury
      .connect(nextOwner)
      .upgradeToAndCall(await nextImplementation.getAddress(), "0x");

    expect(await treasury.version()).to.equal("1.0.2");
    expect(await treasury.aicoin()).to.equal(await aicoin.getAddress());
  });

  it("lets the owner configure limits and rescue every token except AICOIN", async function () {
    const { treasury, platform, user, protocolSigner, other, aicoin } =
      await loadFixture(deployTreasury);
    const stray = await ethers.deployContract("MockPaymentToken");

    await treasury.setPlatform(platform.address, true);
    await expect(
      treasury.connect(platform).claim(
        ethers.ZeroHash,
        user.address,
        AMOUNT,
        BigInt((await time.latest()) + 600),
        "0x",
        "0x"
      )
    ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
    await treasury.setPlatform(platform.address, false);

    await expect(treasury.setSigner(protocolSigner.address))
      .to.emit(treasury, "SignerUpdated")
      .withArgs(ethers.ZeroAddress, protocolSigner.address);
    await expect(treasury.setPlatform(platform.address, true))
      .to.emit(treasury, "PlatformCallerUpdated")
      .withArgs(platform.address, true);
    await treasury.setPlatform(platform.address, false);
    expect(await treasury.isPlatform(platform.address)).to.equal(false);
    await expect(treasury.setMinDeposit(MIN_AMOUNT))
      .to.emit(treasury, "MinDepositUpdated")
      .withArgs(0, MIN_AMOUNT);
    await expect(treasury.setMaxDeposit(MAX_AMOUNT))
      .to.emit(treasury, "MaxDepositUpdated")
      .withArgs(0, MAX_AMOUNT);
    await expect(treasury.setMinClaim(MIN_AMOUNT))
      .to.emit(treasury, "MinClaimUpdated")
      .withArgs(0, MIN_AMOUNT);
    await expect(treasury.setMaxClaim(MAX_AMOUNT))
      .to.emit(treasury, "MaxClaimUpdated")
      .withArgs(0, MAX_AMOUNT);

    await expect(treasury.setSigner(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      treasury,
      "ZeroAddress"
    );
    await expect(
      treasury.setPlatform(ethers.ZeroAddress, true)
    ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
    await expect(
      treasury.connect(other).setSigner(other.address)
    ).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");

    await stray.mint(await treasury.getAddress(), 9n);
    await treasury.rescueERC20(await stray.getAddress(), other.address, 9n);
    expect(await stray.balanceOf(other.address)).to.equal(9n);
    await aicoin.mint(await treasury.getAddress(), AMOUNT);
    await expect(
      treasury.rescueERC20(await aicoin.getAddress(), other.address, AMOUNT)
    ).to.be.revertedWithCustomError(treasury, "CannotRescueAicoin");
    await expect(
      treasury.rescueERC20(ethers.ZeroAddress, other.address, 1)
    ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
    await expect(
      treasury.rescueERC20(await stray.getAddress(), ethers.ZeroAddress, 1)
    ).to.be.revertedWithCustomError(treasury, "ZeroAddress");
  });

  it("pulls a deposit through the token signature and keeps the old operation slot unused", async function () {
    const env = await loadFixture(deployReady);
    const { treasury, user, aicoin, other } = env;
    const deadline = BigInt((await time.latest()) + 600);
    const paymentId = await treasury.computePaymentId(
      await treasury.OP_KIND_DEPOSIT(),
      user.address,
      AMOUNT,
      deadline
    );
    const claimId = await treasury.computePaymentId(
      await treasury.OP_KIND_CLAIM(),
      user.address,
      AMOUNT,
      deadline
    );

    await expect(deposit(env, { caller: other, deadline, paymentId })).to.be.revertedWithCustomError(
      treasury,
      "NotPlatform"
    );
    await expect(
      deposit(env, { paymentId: claimId, deadline })
    ).to.be.revertedWithCustomError(treasury, "PaymentIdMismatch");
    await expect(deposit(env, { payer: ethers.ZeroAddress, deadline })).to.be.revertedWithCustomError(
      treasury,
      "ZeroAddress"
    );

    await aicoin.setTransferWithSigShouldRevert(true);
    await expect(deposit(env, { deadline, paymentId })).to.be.revertedWith("transfer failed");
    expect(await treasury.usedPaymentId(paymentId)).to.equal(false);

    await aicoin.setTransferWithSigShouldRevert(false);
    await expect(deposit(env, { deadline, paymentId, signature: TOKEN_SIGNATURE }))
      .to.emit(treasury, "AicoinDeposited")
      .withArgs(
        paymentId,
        user.address,
        AMOUNT,
        deadline,
        await treasury.PRODUCT_TYPE_DEPOSIT()
      );

    expect(await aicoin.balanceOf(await treasury.getAddress())).to.equal(AMOUNT);
    expect(await aicoin.lastSigFrom()).to.equal(user.address);
    expect(await aicoin.lastSigTo()).to.equal(await treasury.getAddress());
    expect(await aicoin.lastSigAmount()).to.equal(AMOUNT);
    expect(await aicoin.lastSigDeadline()).to.equal(deadline);
    expect(await aicoin.lastSig()).to.equal(TOKEN_SIGNATURE);
    expect(await treasury.usedPaymentId(paymentId)).to.equal(true);
    expect(await treasury.usedOperationId(paymentId)).to.equal(false);
    await expect(deposit(env, { deadline, paymentId })).to.be.revertedWithCustomError(
      treasury,
      "PaymentIdAlreadyUsed"
    );
  });

  it("accepts deposit amounts inside the cap and deadlines inside one hour", async function () {
    const env = await loadFixture(deployReady);
    const { treasury, aicoin, user } = env;

    await deposit(env, { amount: MIN_AMOUNT, deadline: BigInt((await time.latest()) + 100) });
    await deposit(env, { amount: MAX_AMOUNT, deadline: BigInt((await time.latest()) + 200) });
    await expect(
      deposit(env, { amount: MIN_AMOUNT - 1n })
    ).to.be.revertedWithCustomError(treasury, "BelowMinDeposit");
    await expect(
      deposit(env, { amount: MAX_AMOUNT + 1n })
    ).to.be.revertedWithCustomError(treasury, "AboveMaxDeposit");
    await expect(deposit(env, { amount: 0n })).to.be.revertedWithCustomError(
      treasury,
      "InvalidAmount"
    );
    await expect(deposit(env, { deadline: 1n })).to.be.revertedWithCustomError(
      treasury,
      "DeadlineExpired"
    );

    const nowTs = BigInt((await time.latest()) + 30);
    await time.setNextBlockTimestamp(nowTs);
    await deposit(env, { deadline: nowTs });

    const tooFarAt = nowTs + 60n;
    await time.setNextBlockTimestamp(tooFarAt);
    await expect(
      deposit(env, { deadline: tooFarAt + BigInt(SIGNATURE_EXPIRY) + 1n })
    ).to.be.revertedWithCustomError(treasury, "DeadlineTooFar");

    const edgeAt = tooFarAt + 60n;
    await time.setNextBlockTimestamp(edgeAt);
    await deposit(env, { deadline: edgeAt + BigInt(SIGNATURE_EXPIRY) });

    await treasury.setMaxDeposit(0);
    await deposit(env, { amount: MAX_AMOUNT + AMOUNT });
    expect(await aicoin.balanceOf(await treasury.getAddress())).to.equal(
      MIN_AMOUNT + MAX_AMOUNT + AMOUNT + AMOUNT + MAX_AMOUNT + AMOUNT
    );
    expect(await aicoin.balanceOf(user.address)).to.be.lt(MAX_AMOUNT * 20n);
  });

  it("pays a claim after the user and the protocol signer both sign", async function () {
    const env = await loadFixture(deployReady);
    const { treasury, user, aicoin, other } = env;
    const deadline = BigInt((await time.latest()) + 600);
    const paymentId = await treasury.computePaymentId(
      await treasury.OP_KIND_CLAIM(),
      user.address,
      AMOUNT,
      deadline
    );
    await aicoin.mint(await treasury.getAddress(), AMOUNT);

    await expect(claim(env, { caller: other, deadline, paymentId })).to.be.revertedWithCustomError(
      treasury,
      "NotPlatform"
    );
    await expect(
      claim(env, { paymentId: ethers.id("wrong"), deadline })
    ).to.be.revertedWithCustomError(treasury, "PaymentIdMismatch");
    await expect(claim(env, { user: other, deadline, paymentId })).to.be.revertedWithCustomError(
      treasury,
      "InvalidUserSignature"
    );
    await expect(
      claim(env, { protocolSigner: other, deadline, paymentId })
    ).to.be.revertedWithCustomError(treasury, "InvalidSignerSignature");
    await expect(claim(env, { nonce: 1n, deadline, paymentId })).to.be.revertedWithCustomError(
      treasury,
      "InvalidUserSignature"
    );
    await expect(claim(env, { chainId: 1n, deadline, paymentId })).to.be.revertedWithCustomError(
      treasury,
      "InvalidUserSignature"
    );
    expect(await treasury.usedPaymentId(paymentId)).to.equal(false);
    expect(await treasury.claimNonces(user.address)).to.equal(0n);

    await expect(claim(env, { deadline, paymentId }))
      .to.emit(treasury, "AicoinClaimed")
      .withArgs(
        paymentId,
        user.address,
        AMOUNT,
        deadline,
        await treasury.PRODUCT_TYPE_CLAIM()
      );

    expect(await aicoin.balanceOf(user.address)).to.equal(MAX_AMOUNT * 20n + AMOUNT);
    expect(await aicoin.balanceOf(await treasury.getAddress())).to.equal(0n);
    expect(await treasury.claimNonces(user.address)).to.equal(1n);
    expect(await treasury.usedPaymentId(paymentId)).to.equal(true);
    expect(await treasury.usedOperationId(paymentId)).to.equal(false);
    await expect(claim(env, { deadline, paymentId })).to.be.revertedWithCustomError(
      treasury,
      "PaymentIdAlreadyUsed"
    );
  });

  it("does not keep a claim that the treasury cannot pay", async function () {
    const env = await loadFixture(deployReady);
    const { treasury, user, aicoin } = env;
    const deadline = BigInt((await time.latest()) + 600);
    const paymentId = await treasury.computePaymentId(
      await treasury.OP_KIND_CLAIM(),
      user.address,
      AMOUNT,
      deadline
    );

    await expect(claim(env, { deadline, paymentId })).to.be.revertedWithCustomError(
      treasury,
      "InsufficientAicoinBalance"
    );
    expect(await treasury.usedPaymentId(paymentId)).to.equal(false);
    expect(await treasury.claimNonces(user.address)).to.equal(0n);

    await aicoin.mint(await treasury.getAddress(), AMOUNT);
    await claim(env, { deadline, paymentId });
    expect(await aicoin.balanceOf(user.address)).to.equal(MAX_AMOUNT * 20n + AMOUNT);
  });

  it("accepts claim amounts inside the cap", async function () {
    const env = await loadFixture(deployReady);
    const { treasury, aicoin, user } = env;
    const paid = MIN_AMOUNT + MAX_AMOUNT + MAX_AMOUNT + AMOUNT;
    await aicoin.mint(await treasury.getAddress(), paid);

    await claim(env, { amount: MIN_AMOUNT, deadline: BigInt((await time.latest()) + 100) });
    await claim(env, { amount: MAX_AMOUNT, deadline: BigInt((await time.latest()) + 200) });
    await expect(claim(env, { amount: MIN_AMOUNT - 1n })).to.be.revertedWithCustomError(
      treasury,
      "BelowMinClaim"
    );
    await expect(claim(env, { amount: MAX_AMOUNT + 1n })).to.be.revertedWithCustomError(
      treasury,
      "AboveMaxClaim"
    );
    await expect(claim(env, { amount: 0n })).to.be.revertedWithCustomError(
      treasury,
      "InvalidAmount"
    );
    await expect(
      claim(env, { recipient: ethers.ZeroAddress })
    ).to.be.revertedWithCustomError(treasury, "ZeroAddress");

    await treasury.setMaxClaim(0);
    await claim(env, { amount: MAX_AMOUNT + AMOUNT });
    expect(await aicoin.balanceOf(user.address)).to.equal(MAX_AMOUNT * 20n + paid);
    expect(await treasury.claimNonces(user.address)).to.equal(3n);
  });

  it("pauses deposits and claims, and rejects direct ETH", async function () {
    const env = await loadFixture(deployReady);
    const { treasury, owner, aicoin } = env;
    const deadline = BigInt((await time.latest()) + 600);

    await treasury.pause();
    await expect(deposit(env, { deadline })).to.be.revertedWithCustomError(
      treasury,
      "EnforcedPause"
    );
    await expect(claim(env, { deadline })).to.be.revertedWithCustomError(
      treasury,
      "EnforcedPause"
    );

    await treasury.unpause();
    await deposit(env, { deadline });
    expect(await aicoin.balanceOf(await treasury.getAddress())).to.equal(AMOUNT);

    await expect(
      owner.sendTransaction({ to: await treasury.getAddress(), value: 1n })
    ).to.be.revertedWith("Direct ETH transfers not allowed");
    await expect(
      owner.sendTransaction({
        to: await treasury.getAddress(),
        value: 1n,
        data: "0x12345678",
      })
    ).to.be.revertedWith("Fallback not allowed");
  });
});
