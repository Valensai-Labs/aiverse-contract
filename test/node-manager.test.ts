import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers, upgrades } from "hardhat";

async function deployManager() {
  const [owner, nodeA, nodeB, nodeC, signer1, signer2, other] =
    await ethers.getSigners();
  const factory = await ethers.getContractFactory("NodeManagerV1_0_4");
  const manager = await upgrades.deployProxy(factory, []);
  return { owner, nodeA, nodeB, nodeC, signer1, signer2, other, manager };
}

describe("NodeManagerV1_0_4", function () {
  it("initializes an empty node list", async function () {
    const { manager, owner } = await loadFixture(deployManager);

    expect(await manager.version()).to.equal("1.0.4");
    expect(await manager.owner()).to.equal(owner.address);
    expect(await manager.getNodeList()).to.deep.equal([]);
    expect(await manager.isNode(owner.address)).to.equal(false);
    expect(await manager.isValidNodeSigner(owner.address, owner.address)).to.equal(
      false
    );

    await expect(manager.initialize()).to.be.revertedWithCustomError(
      manager,
      "InvalidInitialization"
    );
  });

  it("lets the owner add nodes", async function () {
    const { manager, nodeA, nodeB, other } = await loadFixture(deployManager);

    await expect(manager.addNode(nodeA.address))
      .to.emit(manager, "NodeAdded")
      .withArgs(nodeA.address);
    await manager.addNode(nodeB.address);

    expect(await manager.isNode(nodeA.address)).to.equal(true);
    expect(await manager.getNodeList()).to.deep.equal([
      nodeA.address,
      nodeB.address,
    ]);

    await expect(manager.addNode(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid node address"
    );
    await expect(manager.addNode(nodeA.address)).to.be.revertedWith(
      "Node already exists"
    );
    await expect(manager.connect(other).addNode(other.address))
      .to.be.revertedWithCustomError(manager, "OwnableUnauthorizedAccount")
      .withArgs(other.address);
  });

  it("removes a node with swap-and-pop", async function () {
    const { manager, nodeA, nodeB, nodeC, other } = await loadFixture(deployManager);
    await manager.addNode(nodeA.address);
    await manager.addNode(nodeB.address);
    await manager.addNode(nodeC.address);

    await expect(manager.removeNode(nodeB.address))
      .to.emit(manager, "NodeRemoved")
      .withArgs(nodeB.address);
    expect(await manager.isNode(nodeB.address)).to.equal(false);
    expect(await manager.getNodeList()).to.deep.equal([
      nodeA.address,
      nodeC.address,
    ]);

    await manager.removeNode(nodeA.address);
    expect(await manager.getNodeList()).to.deep.equal([nodeC.address]);
    await manager.removeNode(nodeC.address);
    expect(await manager.getNodeList()).to.deep.equal([]);

    await expect(manager.removeNode(nodeA.address)).to.be.revertedWith(
      "Node not found"
    );
    await expect(manager.connect(other).removeNode(nodeC.address))
      .to.be.revertedWithCustomError(manager, "OwnableUnauthorizedAccount")
      .withArgs(other.address);
  });

  it("lets a node manage its own signers", async function () {
    const { manager, owner, nodeA, nodeB, signer1, signer2 } =
      await loadFixture(deployManager);
    await manager.addNode(nodeA.address);
    await manager.addNode(nodeB.address);

    await expect(manager.connect(nodeA).addNodeSigner(signer1.address))
      .to.emit(manager, "NodeSignerAdded")
      .withArgs(nodeA.address, signer1.address);
    await manager.connect(nodeA).addNodeSigner(signer2.address);
    expect(await manager.isValidNodeSigner(nodeA.address, signer1.address)).to.equal(
      true
    );
    expect(await manager.isValidNodeSigner(nodeB.address, signer1.address)).to.equal(
      false
    );

    await expect(
      manager.connect(nodeA).addNodeSigner(ethers.ZeroAddress)
    ).to.be.revertedWith("Invalid signer address");
    await expect(
      manager.connect(nodeA).addNodeSigner(nodeA.address)
    ).to.be.revertedWith("Signer cannot be the beneficiary");
    await expect(
      manager.connect(nodeA).addNodeSigner(signer1.address)
    ).to.be.revertedWith("Signer already exists");
    await expect(
      manager.connect(owner).addNodeSigner(signer1.address)
    ).to.be.revertedWith("Caller is not a valid node");

    await expect(manager.connect(nodeA).removeNodeSigner(signer1.address))
      .to.emit(manager, "NodeSignerRemoved")
      .withArgs(nodeA.address, signer1.address);
    expect(await manager.isValidNodeSigner(nodeA.address, signer1.address)).to.equal(
      false
    );
    expect(await manager.nodeSigners(nodeA.address, signer2.address)).to.equal(true);

    await expect(
      manager.connect(nodeA).removeNodeSigner(signer1.address)
    ).to.be.revertedWith("Signer not found");
    await expect(
      manager.connect(nodeB).removeNodeSigner(signer2.address)
    ).to.be.revertedWith("Signer not found");
  });

  it("hides signers after removal and restores them if the node returns", async function () {
    const { manager, nodeA, signer1 } = await loadFixture(deployManager);
    await manager.addNode(nodeA.address);
    await manager.connect(nodeA).addNodeSigner(signer1.address);
    await manager.removeNode(nodeA.address);

    expect(await manager.nodeSigners(nodeA.address, signer1.address)).to.equal(true);
    expect(await manager.isValidNodeSigner(nodeA.address, signer1.address)).to.equal(
      false
    );
    await expect(
      manager.connect(nodeA).removeNodeSigner(signer1.address)
    ).to.be.revertedWith("Caller is not a valid node");

    await manager.addNode(nodeA.address);
    expect(await manager.isValidNodeSigner(nodeA.address, signer1.address)).to.equal(
      true
    );
    await expect(
      manager.connect(nodeA).addNodeSigner(signer1.address)
    ).to.be.revertedWith("Signer already exists");
  });

  it("pauses node and signer changes", async function () {
    const { manager, nodeA, nodeB, signer1, signer2, other } =
      await loadFixture(deployManager);
    await manager.addNode(nodeA.address);
    await manager.connect(nodeA).addNodeSigner(signer1.address);

    await manager.pause();
    await expect(manager.addNode(nodeB.address)).to.be.revertedWithCustomError(
      manager,
      "EnforcedPause"
    );
    await expect(manager.removeNode(nodeA.address)).to.be.revertedWithCustomError(
      manager,
      "EnforcedPause"
    );
    await expect(
      manager.connect(nodeA).addNodeSigner(signer2.address)
    ).to.be.revertedWithCustomError(manager, "EnforcedPause");
    await expect(
      manager.connect(nodeA).removeNodeSigner(signer1.address)
    ).to.be.revertedWithCustomError(manager, "EnforcedPause");
    await expect(manager.connect(other).unpause()).to.be.revertedWithCustomError(
      manager,
      "OwnableUnauthorizedAccount"
    ).withArgs(other.address);

    await manager.unpause();
    await manager.addNode(nodeB.address);
    await manager.connect(nodeA).removeNodeSigner(signer1.address);
    expect(await manager.isNode(nodeB.address)).to.equal(true);
    expect(await manager.isValidNodeSigner(nodeA.address, signer1.address)).to.equal(
      false
    );
  });
});
