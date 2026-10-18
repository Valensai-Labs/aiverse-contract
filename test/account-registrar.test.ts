import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Signer } from "ethers";
import { ethers, upgrades } from "hardhat";

const SIGNATURE_EXPIRY = 60 * 60;

const REGISTRATION_TYPES = {
  Registration: [
    { name: "userAddr", type: "address" },
    { name: "emailHash", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "chainid", type: "uint256" },
    { name: "expireAt", type: "uint256" },
  ],
};

async function deployFixture() {
  const [owner, protocolSigner, authSender, user, other] =
    await ethers.getSigners();

  const powerAsset = await ethers.deployContract("MockPowerAsset");
  const coin = await ethers.deployContract("MockAiverseCoin");
  const reward = ethers.parseEther("10");

  const factory = await ethers.getContractFactory("AccountRegistrarV1_0_9");
  const registrar = await upgrades.deployProxy(
    factory,
    [await powerAsset.getAddress()],
    { initializer: "initialize" }
  );

  await registrar.setAiverseCoin(await coin.getAddress());
  await registrar.setSigner(protocolSigner.address);
  await registrar.addAuthSender(authSender.address);
  await registrar.setRegistrationReward(reward);
  await coin.mint(await registrar.getAddress(), ethers.parseEther("1000"));

  return {
    registrar,
    powerAsset,
    coin,
    owner,
    protocolSigner,
    authSender,
    user,
    other,
    reward,
  };
}

type Fixture = Awaited<ReturnType<typeof deployFixture>>;

async function registerCall(
  {
    registrar,
    protocolSigner,
    authSender,
  }: Pick<Fixture, "registrar" | "protocolSigner" | "authSender">,
  user: Signer,
  referer: string,
  email: string,
  overrides: {
    caller?: Signer;
    nonce?: bigint;
    expireAt?: bigint;
    chainId?: bigint;
    signerWallet?: Signer;
    userWallet?: Signer;
  } = {}
) {
  const userAddr = await user.getAddress();
  const emailHash = ethers.id(email);
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const nonce = overrides.nonce ?? (await registrar.nonces(userAddr));
  const expireAt =
    overrides.expireAt ?? BigInt((await time.latest()) + 10 * 60);
  const message = {
    userAddr,
    emailHash,
    nonce,
    chainid: overrides.chainId ?? chainId,
    expireAt,
  };
  const domain = {
    name: "Aiverse-Account-Registrar",
    version: "1",
    chainId,
    verifyingContract: await registrar.getAddress(),
  };
  const signerWallet = overrides.signerWallet ?? protocolSigner;
  const userWallet = overrides.userWallet ?? user;

  return registrar
    .connect(overrides.caller ?? authSender)
    .registerByEmail(
      userAddr,
      referer,
      emailHash,
      await signerWallet.signTypedData(domain, REGISTRATION_TYPES, message),
      await userWallet.signTypedData(domain, REGISTRATION_TYPES, message),
      expireAt
    );
}

describe("AccountRegistrar V1.0.9", function () {
  it("initializes owner, version, and power asset", async function () {
    const { registrar, owner, powerAsset } = await loadFixture(deployFixture);

    expect(await registrar.version()).to.equal("1.0.9");
    expect(await registrar.owner()).to.equal(owner.address);
    expect(await registrar.powerAsset()).to.equal(await powerAsset.getAddress());
    expect(await registrar.SIGNATURE_EXPIRY()).to.equal(SIGNATURE_EXPIRY);

    await expect(
      registrar.initialize(await powerAsset.getAddress())
    ).to.be.revertedWithCustomError(registrar, "InvalidInitialization");
  });

  it("lets the owner configure signer, coin, reward, and auth sender", async function () {
    const { registrar, coin, protocolSigner, authSender, reward, other } =
      await loadFixture(deployFixture);
    const nextPower = await ethers.deployContract("MockPowerAsset");

    await registrar.setPowerAsset(await nextPower.getAddress());

    expect(await registrar.powerAsset()).to.equal(await nextPower.getAddress());
    expect(await registrar.aiverseCoin()).to.equal(await coin.getAddress());
    expect(await registrar.signerAddress()).to.equal(protocolSigner.address);
    expect(await registrar.registrationReward()).to.equal(reward);
    expect(await registrar.isAuthSender(authSender.address)).to.equal(true);

    await registrar.removeAuthSender(authSender.address);
    expect(await registrar.isAuthSender(authSender.address)).to.equal(false);

    await expect(
      registrar.connect(other).setSigner(other.address)
    ).to.be.revertedWithCustomError(registrar, "OwnableUnauthorizedAccount");
    await expect(registrar.connect(other).pause()).to.be.revertedWithCustomError(
      registrar,
      "OwnableUnauthorizedAccount"
    );
  });

  it("rejects zero addresses in admin setters", async function () {
    const { registrar } = await loadFixture(deployFixture);

    await expect(registrar.setPowerAsset(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid PowerAsset address"
    );
    await expect(registrar.setAiverseCoin(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid AiverseCoin address"
    );
    await expect(registrar.setSigner(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid signer address"
    );
    await expect(registrar.addAuthSender(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid sender address"
    );
  });

  it("registers a user referred by the protocol signer", async function () {
    const {
      registrar,
      powerAsset,
      coin,
      protocolSigner,
      authSender,
      user,
      reward,
    } = await loadFixture(deployFixture);
    const emailHash = ethers.id("alice@example.com");

    await expect(
      registerCall(
        { registrar, protocolSigner, authSender },
        user,
        protocolSigner.address,
        "alice@example.com"
      )
    )
      .to.emit(registrar, "UserRegistered")
      .withArgs(user.address, protocolSigner.address, emailHash);

    expect(await registrar.userEmailHash(user.address)).to.equal(emailHash);
    expect(await registrar.emailHashToAddr(emailHash)).to.equal(user.address);
    expect(await registrar.referral(user.address)).to.equal(protocolSigner.address);
    expect(await registrar.nonces(user.address)).to.equal(1n);
    expect(await powerAsset.lastRegistrationNode()).to.equal(protocolSigner.address);
    expect(await powerAsset.registrationRewardMints()).to.equal(1n);
    expect(await coin.balanceOf(user.address)).to.equal(reward);
  });

  it("accepts an already registered user as referer", async function () {
    const { registrar, powerAsset, protocolSigner, authSender, user, other } =
      await loadFixture(deployFixture);

    await registerCall(
      { registrar, protocolSigner, authSender },
      user,
      protocolSigner.address,
      "alice@example.com"
    );
    await registerCall(
      { registrar, protocolSigner, authSender },
      other,
      user.address,
      "bob@example.com"
    );

    expect(await registrar.referral(other.address)).to.equal(user.address);
    expect(await powerAsset.lastRegistrationNode()).to.equal(protocolSigner.address);
    expect(await powerAsset.registrationRewardMints()).to.equal(2n);
  });

  it("blocks registration unless the caller is an authorized sender", async function () {
    const { registrar, protocolSigner, authSender, user, other } =
      await loadFixture(deployFixture);

    await expect(
      registerCall(
        { registrar, protocolSigner, authSender },
        user,
        protocolSigner.address,
        "alice@example.com",
        { caller: other }
      )
    ).to.be.revertedWith("Caller must be an authorized sender");

    await registrar.removeAuthSender(authSender.address);
    await expect(
      registerCall(
        { registrar, protocolSigner, authSender },
        user,
        protocolSigner.address,
        "alice@example.com"
      )
    ).to.be.revertedWith("Caller must be an authorized sender");
  });

  it("rejects empty or self-referential registration inputs", async function () {
    const { registrar, protocolSigner, authSender, user } =
      await loadFixture(deployFixture);
    const expireAt = BigInt((await time.latest()) + 600);
    const signature = "0x" + "11".repeat(65);

    await expect(
      registrar.connect(authSender).registerByEmail(
        user.address,
        protocolSigner.address,
        ethers.ZeroHash,
        signature,
        signature,
        expireAt
      )
    ).to.be.revertedWith("Invalid email hash");
    await expect(
      registrar.connect(authSender).registerByEmail(
        ethers.ZeroAddress,
        protocolSigner.address,
        ethers.id("alice@example.com"),
        signature,
        signature,
        expireAt
      )
    ).to.be.revertedWith("Invalid user address");
    await expect(
      registrar.connect(authSender).registerByEmail(
        user.address,
        ethers.ZeroAddress,
        ethers.id("alice@example.com"),
        signature,
        signature,
        expireAt
      )
    ).to.be.revertedWith("Invalid referer address");
    await expect(
      registerCall(
        { registrar, protocolSigner, authSender },
        user,
        user.address,
        "alice@example.com"
      )
    ).to.be.revertedWith("Self referral not allowed");
  });

  it("rejects expired signatures and expiries beyond one hour", async function () {
    const { registrar, protocolSigner, authSender, user } =
      await loadFixture(deployFixture);
    const now = await time.latest();

    await time.setNextBlockTimestamp(now + 10);
    await expect(
      registerCall(
        { registrar, protocolSigner, authSender },
        user,
        protocolSigner.address,
        "alice@example.com",
        { expireAt: BigInt(now + 9) }
      )
    ).to.be.revertedWith("Signature expired");

    const next = now + 20;
    await time.setNextBlockTimestamp(next);
    await expect(
      registerCall(
        { registrar, protocolSigner, authSender },
        user,
        protocolSigner.address,
        "alice@example.com",
        { expireAt: BigInt(next + SIGNATURE_EXPIRY + 1) }
      )
    ).to.be.revertedWith("Expiry too far in future");
  });

  it("rejects an unregistered referer that is not the signer", async function () {
    const { registrar, protocolSigner, authSender, user, other } =
      await loadFixture(deployFixture);

    await expect(
      registerCall(
        { registrar, protocolSigner, authSender },
        user,
        other.address,
        "alice@example.com"
      )
    ).to.be.revertedWith("Invalid referer");
  });

  it("rejects a reused email or address", async function () {
    const { registrar, protocolSigner, authSender, user, other } =
      await loadFixture(deployFixture);

    await registerCall(
      { registrar, protocolSigner, authSender },
      user,
      protocolSigner.address,
      "alice@example.com"
    );

    await expect(
      registerCall(
        { registrar, protocolSigner, authSender },
        other,
        user.address,
        "alice@example.com"
      )
    ).to.be.revertedWith("Email already registered");
    await expect(
      registerCall(
        { registrar, protocolSigner, authSender },
        user,
        protocolSigner.address,
        "alice-alt@example.com"
      )
    ).to.be.revertedWith("Address already registered");
  });

  it("rejects signatures from the wrong signer, user, nonce, or chain", async function () {
    const { registrar, protocolSigner, authSender, user, other } =
      await loadFixture(deployFixture);
    const base = { registrar, protocolSigner, authSender };
    const email = "alice@example.com";

    await expect(
      registerCall(base, user, protocolSigner.address, email, {
        signerWallet: other,
      })
    ).to.be.revertedWith("Invalid signature");
    await expect(
      registerCall(base, user, protocolSigner.address, email, {
        userWallet: other,
      })
    ).to.be.revertedWith("Invalid signature");
    await expect(
      registerCall(base, user, protocolSigner.address, email, { nonce: 1n })
    ).to.be.revertedWith("Invalid signature");
    await expect(
      registerCall(base, user, protocolSigner.address, email, { chainId: 1n })
    ).to.be.revertedWith("Invalid signature");
  });

  it("rejects registration while paused and allows it after unpause", async function () {
    const { registrar, protocolSigner, authSender, user } =
      await loadFixture(deployFixture);
    const call = () =>
      registerCall(
        { registrar, protocolSigner, authSender },
        user,
        protocolSigner.address,
        "alice@example.com"
      );

    await registrar.pause();
    await expect(call()).to.be.revertedWithCustomError(registrar, "EnforcedPause");

    await registrar.unpause();
    await expect(call()).to.emit(registrar, "UserRegistered");
  });

  it("reverts when the reward transfer fails", async function () {
    const { registrar, coin, protocolSigner, authSender, user } =
      await loadFixture(deployFixture);

    await coin.setTransferShouldFail(true);
    await expect(
      registerCall(
        { registrar, protocolSigner, authSender },
        user,
        protocolSigner.address,
        "alice@example.com"
      )
    ).to.be.revertedWith("AICOIN transfer failed");
    expect(await registrar.userEmailHash(user.address)).to.equal(ethers.ZeroHash);
  });
});
