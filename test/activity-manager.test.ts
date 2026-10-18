import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Signer } from "ethers";
import { ethers, upgrades } from "hardhat";

const SIGNATURE_EXPIRY = 2 * 60;
const MIN_CLAIM = ethers.parseEther("60");
const MAX_MINT = ethers.parseEther("1000");
const CLAIM_AMOUNT = ethers.parseEther("100");

const CLAIM_TYPES = {
  ActivityClaim: [
    { name: "userAddr", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "chainid", type: "uint256" },
    { name: "expireAt", type: "uint256" },
  ],
};

async function deployBase() {
  const [owner, foundation, nodeSigner, relayerNode, user, other] =
    await ethers.getSigners();

  const powerAsset = await ethers.deployContract("MockPowerAsset");
  const nodeManager = await ethers.deployContract("MockNodeManager");
  await nodeManager.setNode(relayerNode.address, true);
  await nodeManager.setValidNodeSigner(
    relayerNode.address,
    nodeSigner.address,
    true
  );

  const factory = await ethers.getContractFactory("ActivityManagerV1_0_1");
  const manager = await upgrades.deployProxy(factory, [
    await nodeManager.getAddress(),
    await powerAsset.getAddress(),
  ]);

  return {
    owner,
    foundation,
    nodeSigner,
    relayerNode,
    user,
    other,
    powerAsset,
    nodeManager,
    manager,
  };
}

async function deployFixture() {
  const base = await deployBase();
  await base.manager.setMaxMint(MAX_MINT);
  await base.manager.setMinClaim(MIN_CLAIM);
  await base.manager.setFoundationSigner(base.foundation.address);
  return base;
}

type Fixture = Awaited<ReturnType<typeof deployFixture>>;

async function signClaim(
  { manager, foundation }: Pick<Fixture, "manager" | "foundation">,
  user: Signer,
  amount: bigint,
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
  const nonce = overrides.nonce ?? (await manager.nonces(userAddr));
  const expireAt = overrides.expireAt ?? BigInt((await time.latest()) + 60);
  const message = {
    userAddr,
    amount,
    nonce,
    chainid: overrides.chainId ?? chainId,
    expireAt,
  };
  const domain = {
    name: "Aiverse-Activity-Manager",
    version: "1",
    chainId,
    verifyingContract: await manager.getAddress(),
  };
  const userWallet = overrides.userWallet ?? user;
  const foundationWallet = overrides.foundationWallet ?? foundation;

  return {
    userAddr,
    expireAt,
    userSig: await userWallet.signTypedData(domain, CLAIM_TYPES, message),
    foundationSig: await foundationWallet.signTypedData(
      domain,
      CLAIM_TYPES,
      message
    ),
  };
}

async function claimActivity(
  fixture: Pick<
    Fixture,
    "manager" | "foundation" | "nodeSigner" | "relayerNode"
  >,
  user: Signer,
  amount: bigint,
  overrides: Parameters<typeof signClaim>[3] & { caller?: Signer } = {}
) {
  const signed = await signClaim(fixture, user, amount, overrides);
  return fixture.manager
    .connect(overrides.caller ?? fixture.nodeSigner)
    .claimActivity(
      signed.userAddr,
      fixture.relayerNode.address,
      amount,
      signed.expireAt,
      signed.userSig,
      signed.foundationSig
    );
}

async function claimActivitySelf(
  fixture: Pick<Fixture, "manager" | "foundation" | "relayerNode">,
  user: Signer,
  amount: bigint,
  overrides: Parameters<typeof signClaim>[3] & {
    caller?: Signer;
    relayer?: string;
  } = {}
) {
  const caller = overrides.caller ?? user;
  const signed = await signClaim(fixture, caller, amount, overrides);
  return fixture.manager
    .connect(caller)
    .claimActivitySelf(
      overrides.relayer ?? fixture.relayerNode.address,
      amount,
      signed.expireAt,
      signed.foundationSig
    );
}

describe("ActivityManager V1.0.1", function () {
  it("initializes owner, version, and dependencies", async function () {
    const { manager, owner, nodeManager, powerAsset } =
      await loadFixture(deployBase);

    expect(await manager.version()).to.equal("1.0.1");
    expect(await manager.owner()).to.equal(owner.address);
    expect(await manager.nodeManager()).to.equal(await nodeManager.getAddress());
    expect(await manager.powerAsset()).to.equal(await powerAsset.getAddress());
    expect(await manager.SIGNATURE_EXPIRY()).to.equal(SIGNATURE_EXPIRY);
    expect(await manager.minClaim()).to.equal(0n);
    expect(await manager.maxMint()).to.equal(0n);

    await expect(
      manager.initialize(
        await nodeManager.getAddress(),
        await powerAsset.getAddress()
      )
    ).to.be.revertedWithCustomError(manager, "InvalidInitialization");
  });

  it("lets the owner set claim bounds, foundation signer, and power asset", async function () {
    const { manager, foundation, other } = await loadFixture(deployFixture);
    const nextPower = await ethers.deployContract("MockPowerAsset");

    await manager.setPowerAsset(await nextPower.getAddress());

    expect(await manager.powerAsset()).to.equal(await nextPower.getAddress());
    expect(await manager.minClaim()).to.equal(MIN_CLAIM);
    expect(await manager.maxMint()).to.equal(MAX_MINT);
    expect(await manager.foundationSigner()).to.equal(foundation.address);

    await expect(
      manager.connect(other).setFoundationSigner(other.address)
    ).to.be.revertedWithCustomError(manager, "OwnableUnauthorizedAccount");
    await expect(manager.connect(other).pause()).to.be.revertedWithCustomError(
      manager,
      "OwnableUnauthorizedAccount"
    );
  });

  it("rejects invalid admin values and requires max mint before min claim", async function () {
    const { manager } = await loadFixture(deployBase);

    await expect(
      manager.setFoundationSigner(ethers.ZeroAddress)
    ).to.be.revertedWith("Invalid foundation signer");
    await expect(manager.setPowerAsset(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid power asset"
    );
    await expect(manager.setMinClaim(0)).to.be.revertedWith("Invalid min claim");
    await expect(manager.setMinClaim(MIN_CLAIM)).to.be.revertedWith(
      "Min claim must be below max mint"
    );
    await expect(manager.setMaxMint(0)).to.be.revertedWith(
      "Max mint must exceed min claim"
    );

    await expect(manager.setMaxMint(MAX_MINT))
      .to.emit(manager, "MaxMintUpdated")
      .withArgs(0, MAX_MINT);
    await expect(manager.setMinClaim(MIN_CLAIM))
      .to.emit(manager, "MinClaimUpdated")
      .withArgs(0, MIN_CLAIM);
    await expect(manager.setMinClaim(MAX_MINT)).to.be.revertedWith(
      "Min claim must be below max mint"
    );
    await expect(manager.setMaxMint(MIN_CLAIM)).to.be.revertedWith(
      "Max mint must exceed min claim"
    );
  });

  it("claims activity rewards for a user through a node signer", async function () {
    const fixture = await loadFixture(deployFixture);
    const { manager, powerAsset, relayerNode, user } = fixture;

    await expect(claimActivity(fixture, user, CLAIM_AMOUNT))
      .to.emit(manager, "ActivityClaimed")
      .withArgs(user.address, relayerNode.address, CLAIM_AMOUNT, 0n);

    const mint = await powerAsset.lastActivityMint();
    expect(mint.user).to.equal(user.address);
    expect(mint.relayerNode).to.equal(relayerNode.address);
    expect(mint.amount).to.equal(CLAIM_AMOUNT);
    expect(await powerAsset.activityRewardMints()).to.equal(1n);
    expect(await manager.nonces(user.address)).to.equal(1n);
    expect(await manager.getNonce(user.address)).to.equal(1n);
  });

  it("accepts an amount equal to the minimum or the maximum", async function () {
    const fixture = await loadFixture(deployFixture);
    const { manager, user } = fixture;

    await expect(claimActivity(fixture, user, MIN_CLAIM)).to.emit(
      manager,
      "ActivityClaimed"
    );
    await expect(claimActivity(fixture, user, MAX_MINT)).to.emit(
      manager,
      "ActivityClaimed"
    );
    expect(await manager.nonces(user.address)).to.equal(2n);
  });

  it("lets the user self-claim against a registered node", async function () {
    const fixture = await loadFixture(deployFixture);
    const { manager, powerAsset, relayerNode, user } = fixture;

    await expect(claimActivitySelf(fixture, user, CLAIM_AMOUNT))
      .to.emit(manager, "ActivityClaimed")
      .withArgs(user.address, relayerNode.address, CLAIM_AMOUNT, 0n);

    const mint = await powerAsset.lastActivityMint();
    expect(mint.user).to.equal(user.address);
    expect(mint.relayerNode).to.equal(relayerNode.address);
    expect(await manager.nonces(user.address)).to.equal(1n);
  });

  it("rejects a caller who is not the node signer, or a relayer that is not a node", async function () {
    const fixture = await loadFixture(deployFixture);
    const { user, other } = fixture;

    await expect(
      claimActivity(fixture, user, CLAIM_AMOUNT, { caller: other })
    ).to.be.revertedWith("Invalid Node Or Signer");
    await expect(
      claimActivitySelf(fixture, user, CLAIM_AMOUNT, { relayer: other.address })
    ).to.be.revertedWith("Invalid relayer node");
  });

  it("rejects an empty user or an amount outside the claim range", async function () {
    const fixture = await loadFixture(deployFixture);
    const { manager, nodeSigner, relayerNode, user } = fixture;
    const expireAt = BigInt((await time.latest()) + 60);
    const signature = "0x" + "11".repeat(65);

    await expect(
      manager
        .connect(nodeSigner)
        .claimActivity(
          ethers.ZeroAddress,
          relayerNode.address,
          CLAIM_AMOUNT,
          expireAt,
          signature,
          signature
        )
    ).to.be.revertedWith("Invalid user address");
    await expect(
      claimActivity(fixture, user, MIN_CLAIM - 1n)
    ).to.be.revertedWith("Below min claim");
    await expect(
      claimActivity(fixture, user, MAX_MINT + 1n)
    ).to.be.revertedWith("Above max mint");
  });

  it("rejects expired signatures and expiries beyond two minutes", async function () {
    const fixture = await loadFixture(deployFixture);
    const { user } = fixture;
    const now = await time.latest();

    await time.setNextBlockTimestamp(now + 10);
    await expect(
      claimActivity(fixture, user, CLAIM_AMOUNT, { expireAt: BigInt(now + 9) })
    ).to.be.revertedWith("Signature expired");

    const next = now + 20;
    await time.setNextBlockTimestamp(next);
    await expect(
      claimActivity(fixture, user, CLAIM_AMOUNT, {
        expireAt: BigInt(next + SIGNATURE_EXPIRY + 1),
      })
    ).to.be.revertedWith("Expiry too far in future");
  });

  it("rejects signatures from the wrong user, foundation, nonce, or chain", async function () {
    const fixture = await loadFixture(deployFixture);
    const { user, other } = fixture;

    await expect(
      claimActivity(fixture, user, CLAIM_AMOUNT, { userWallet: other })
    ).to.be.revertedWith("Invalid user signature");
    await expect(
      claimActivity(fixture, user, CLAIM_AMOUNT, { foundationWallet: other })
    ).to.be.revertedWith("Invalid foundation signature");
    await expect(
      claimActivity(fixture, user, CLAIM_AMOUNT, { nonce: 1n })
    ).to.be.revertedWith("Invalid user signature");
    await expect(
      claimActivity(fixture, user, CLAIM_AMOUNT, { chainId: 1n })
    ).to.be.revertedWith("Invalid user signature");
    await expect(
      claimActivitySelf(fixture, user, CLAIM_AMOUNT, { foundationWallet: other })
    ).to.be.revertedWith("Invalid foundation signature");
  });

  it("consumes the nonce so the same signature cannot be replayed", async function () {
    const fixture = await loadFixture(deployFixture);
    const { manager, nodeSigner, relayerNode, user } = fixture;
    const signed = await signClaim(fixture, user, CLAIM_AMOUNT);

    await manager
      .connect(nodeSigner)
      .claimActivity(
        signed.userAddr,
        relayerNode.address,
        CLAIM_AMOUNT,
        signed.expireAt,
        signed.userSig,
        signed.foundationSig
      );

    await expect(
      manager
        .connect(nodeSigner)
        .claimActivity(
          signed.userAddr,
          relayerNode.address,
          CLAIM_AMOUNT,
          signed.expireAt,
          signed.userSig,
          signed.foundationSig
        )
    ).to.be.revertedWith("Invalid user signature");
    expect(await manager.nonces(user.address)).to.equal(1n);
  });

  it("blocks claims and admin updates while paused", async function () {
    const fixture = await loadFixture(deployFixture);
    const { manager, user } = fixture;

    await manager.pause();
    await expect(claimActivity(fixture, user, CLAIM_AMOUNT)).to.be.revertedWithCustomError(
      manager,
      "EnforcedPause"
    );
    await expect(manager.setMaxMint(MAX_MINT + 1n)).to.be.revertedWithCustomError(
      manager,
      "EnforcedPause"
    );

    await manager.unpause();
    await expect(claimActivity(fixture, user, CLAIM_AMOUNT)).to.emit(
      manager,
      "ActivityClaimed"
    );
  });
});
