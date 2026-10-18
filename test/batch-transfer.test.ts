import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

const MAX_BATCH_SIZE = 2n;

async function deployBatch() {
  const [owner, operator, alice, bob, carol, other] = await ethers.getSigners();
  const aiHash = await ethers.deployContract("MockPaymentToken");
  const aiCoin = await ethers.deployContract("MockPaymentToken");
  const batch = await ethers.deployContract("BatchTransfer");
  await batch.initialize(
    await aiHash.getAddress(),
    await aiCoin.getAddress(),
    MAX_BATCH_SIZE
  );
  await batch.setAuthorizedOperator(operator.address, true);

  return { owner, operator, alice, bob, carol, other, aiHash, aiCoin, batch };
}

async function fund(
  token: Awaited<ReturnType<typeof deployBatch>>["aiHash"],
  holder: Awaited<ReturnType<typeof deployBatch>>["operator"],
  spender: string,
  amount: bigint
) {
  await token.mint(holder.address, amount);
  await token.connect(holder).approve(spender, amount);
}

describe("BatchTransfer V1", function () {
  it("initializes both tokens and rejects invalid arguments", async function () {
    const { batch, owner, aiHash, aiCoin } = await loadFixture(deployBatch);

    expect(await batch.version()).to.equal("1.0.0");
    expect(await batch.owner()).to.equal(owner.address);
    expect(await batch.aiHash()).to.equal(await aiHash.getAddress());
    expect(await batch.aiCoin()).to.equal(await aiCoin.getAddress());
    expect(await batch.maxBatchSize()).to.equal(MAX_BATCH_SIZE);
    expect(await batch.getMaxBatchSize()).to.equal(MAX_BATCH_SIZE);
    expect(await batch.isAuthorized(owner.address)).to.equal(true);

    await expect(
      batch.initialize(await aiHash.getAddress(), await aiCoin.getAddress(), 1)
    ).to.be.revertedWithCustomError(batch, "InvalidInitialization");

    const fresh = await ethers.deployContract("BatchTransfer");
    await expect(
      fresh.initialize(ethers.ZeroAddress, await aiCoin.getAddress(), 1)
    ).to.be.revertedWith("Invalid AIHASH address");
    await expect(
      fresh.initialize(await aiHash.getAddress(), ethers.ZeroAddress, 1)
    ).to.be.revertedWith("Invalid AICOIN address");
    await expect(
      fresh.initialize(await aiHash.getAddress(), await aiCoin.getAddress(), 0)
    ).to.be.revertedWith("Max batch size must be greater than 0");
  });

  it("lets the owner authorize operators and change the batch size", async function () {
    const { batch, operator, other } = await loadFixture(deployBatch);

    expect(await batch.isAuthorized(operator.address)).to.equal(true);
    expect(await batch.authorizedOperators(operator.address)).to.equal(true);
    expect(await batch.isAuthorized(other.address)).to.equal(false);

    await expect(batch.setAuthorizedOperator(operator.address, false))
      .to.emit(batch, "OperatorAuthorized")
      .withArgs(operator.address, false);
    expect(await batch.isAuthorized(operator.address)).to.equal(false);

    await expect(batch.setMaxBatchSize(5))
      .to.emit(batch, "MaxBatchSizeUpdated")
      .withArgs(MAX_BATCH_SIZE, 5);
    expect(await batch.getMaxBatchSize()).to.equal(5n);

    await expect(
      batch.setAuthorizedOperator(ethers.ZeroAddress, true)
    ).to.be.revertedWith("Invalid operator address");
    await expect(batch.setMaxBatchSize(0)).to.be.revertedWith(
      "Max batch size must be greater than 0"
    );
    await expect(
      batch.connect(other).setAuthorizedOperator(other.address, true)
    ).to.be.revertedWithCustomError(batch, "OwnableUnauthorizedAccount");
    await expect(batch.connect(other).pause()).to.be.revertedWithCustomError(
      batch,
      "OwnableUnauthorizedAccount"
    );
  });

  it("transfers AIHASH from the caller to each recipient", async function () {
    const { batch, operator, alice, bob, aiHash } = await loadFixture(deployBatch);
    const recipients = [alice.address, bob.address];
    const amounts = [10n, 25n];
    await fund(aiHash, operator, await batch.getAddress(), 35n);

    await expect(
      batch.connect(operator).batchTransferAIHASH(recipients, amounts)
    )
      .to.emit(batch, "BatchTransferAIHASH")
      .withArgs(operator.address, recipients, amounts);

    expect(await aiHash.balanceOf(alice.address)).to.equal(10n);
    expect(await aiHash.balanceOf(bob.address)).to.equal(25n);
    expect(await aiHash.balanceOf(operator.address)).to.equal(0n);
    expect(await aiHash.balanceOf(await batch.getAddress())).to.equal(0n);
  });

  it("transfers AICOIN when the owner calls, without a separate operator grant", async function () {
    const { batch, owner, alice, bob, aiCoin } = await loadFixture(deployBatch);
    const recipients = [alice.address, bob.address];
    const amounts = [4n, 6n];
    await fund(aiCoin, owner, await batch.getAddress(), 10n);

    await expect(batch.connect(owner).batchTransferAICOIN(recipients, amounts))
      .to.emit(batch, "BatchTransferAICOIN")
      .withArgs(owner.address, recipients, amounts);

    expect(await aiCoin.balanceOf(alice.address)).to.equal(4n);
    expect(await aiCoin.balanceOf(bob.address)).to.equal(6n);
    expect(await aiCoin.balanceOf(owner.address)).to.equal(0n);
  });

  it("rejects a malformed batch before moving tokens", async function () {
    const { batch, operator, alice, bob, carol, aiHash } = await loadFixture(deployBatch);
    await fund(aiHash, operator, await batch.getAddress(), 100n);
    const asOperator = batch.connect(operator);

    await expect(
      asOperator.batchTransferAIHASH([alice.address], [1n, 2n])
    ).to.be.revertedWith("Recipients and amounts length mismatch");
    await expect(asOperator.batchTransferAIHASH([], [])).to.be.revertedWith(
      "Recipients array cannot be empty"
    );
    await expect(
      asOperator.batchTransferAIHASH(
        [alice.address, bob.address, carol.address],
        [1n, 1n, 1n]
      )
    ).to.be.revertedWith("Exceeds max batch size");
    await expect(
      asOperator.batchTransferAIHASH([ethers.ZeroAddress], [1n])
    ).to.be.revertedWith("Invalid recipient address");
    await expect(
      asOperator.batchTransferAIHASH([alice.address], [0n])
    ).to.be.revertedWith("Amount must be greater than 0");

    await expect(
      asOperator.batchTransferAIHASH([alice.address, bob.address], [1n, 0n])
    ).to.be.revertedWith("Amount must be greater than 0");
    expect(await aiHash.balanceOf(alice.address)).to.equal(0n);
    expect(await aiHash.balanceOf(operator.address)).to.equal(100n);
  });

  it("rejects callers who are not the owner or an authorized operator", async function () {
    const { batch, operator, alice, other, aiHash } = await loadFixture(deployBatch);
    await fund(aiHash, other, await batch.getAddress(), 5n);
    await fund(aiHash, operator, await batch.getAddress(), 5n);

    await expect(
      batch.connect(other).batchTransferAIHASH([alice.address], [5n])
    ).to.be.revertedWith("Not authorized");

    await batch.setAuthorizedOperator(operator.address, false);
    await expect(
      batch.connect(operator).batchTransferAIHASH([alice.address], [5n])
    ).to.be.revertedWith("Not authorized");
    expect(await aiHash.balanceOf(alice.address)).to.equal(0n);
  });

  it("rolls back the whole batch when a later transfer fails", async function () {
    const { batch, operator, alice, bob, aiHash } = await loadFixture(deployBatch);
    await aiHash.mint(operator.address, 10n);
    await aiHash.connect(operator).approve(await batch.getAddress(), 100n);

    await expect(
      batch.connect(operator).batchTransferAIHASH(
        [alice.address, bob.address],
        [10n, 1n]
      )
    ).to.be.revertedWith("insufficient balance");
    expect(await aiHash.balanceOf(alice.address)).to.equal(0n);
    expect(await aiHash.balanceOf(operator.address)).to.equal(10n);
  });

  it("pauses both token paths and rejects direct ETH", async function () {
    const { batch, owner, operator, alice, aiHash, aiCoin } =
      await loadFixture(deployBatch);
    await fund(aiHash, operator, await batch.getAddress(), 3n);
    await fund(aiCoin, operator, await batch.getAddress(), 3n);

    await batch.pause();
    await expect(
      batch.connect(operator).batchTransferAIHASH([alice.address], [1n])
    ).to.be.revertedWithCustomError(batch, "EnforcedPause");
    await expect(
      batch.connect(operator).batchTransferAICOIN([alice.address], [1n])
    ).to.be.revertedWithCustomError(batch, "EnforcedPause");

    await batch.unpause();
    await batch.connect(operator).batchTransferAIHASH([alice.address], [1n]);
    expect(await aiHash.balanceOf(alice.address)).to.equal(1n);

    await expect(
      owner.sendTransaction({ to: await batch.getAddress(), value: 1n })
    ).to.be.revertedWith("Direct ETH transfers not allowed");
    await expect(
      owner.sendTransaction({
        to: await batch.getAddress(),
        value: 1n,
        data: "0x12345678",
      })
    ).to.be.revertedWith("Fallback not allowed");
  });
});
