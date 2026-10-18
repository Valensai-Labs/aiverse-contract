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
const DAY = 24 * 60 * 60;
const EMERGENCY_MIGRATOR = "0x99999990a6cf1104c6a865C84f4bA42e28F99bD5";

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

async function deployCoin() {
  const [owner, foundation, stakeController, executor, user, other] =
    await ethers.getSigners();

  const factory = await ethers.getContractFactory("AiverseCoinV1_0_6");
  const coin = await upgrades.deployProxy(
    factory,
    ["Aiverse Coin", "AICOIN", foundation.address],
    { initializer: "initialize" }
  );
  await coin.initializeV2();

  return { owner, foundation, stakeController, executor, user, other, coin };
}

async function deployFixture() {
  const base = await deployCoin();
  await base.coin.setStakeController(base.stakeController.address);
  await base.coin.setWhitelistAddr(base.executor.address, true);
  return base;
}

type Fixture = Awaited<ReturnType<typeof deployFixture>>;

async function signedTransfer(
  { coin }: Pick<Fixture, "coin">,
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
  const nonce = overrides.nonce ?? (await coin.nonces(fromAddr));
  const expireAt = overrides.expireAt ?? BigInt((await time.latest()) + 600);
  const domain = {
    name: "Aiverse-Coin",
    version: "1",
    chainId,
    verifyingContract: await coin.getAddress(),
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

  return coin
    .connect(executor)
    .transferWithSig(fromAddr, to, amount, expireAt, signature);
}

describe("AiverseCoin V1.0.6", function () {
  it("mints the foundation supply and sets the daily reward", async function () {
    const { coin, owner, foundation } = await loadFixture(deployCoin);
    const maxSupply = await coin.MAX_TOTAL_SUPPLY();
    const foundationSupply = await coin.FOUNDATION_SUPPLY();
    const period = await coin.HALVING_PERIOD_DAYS();

    expect(await coin.version()).to.equal("1.0.6");
    expect(await coin.name()).to.equal("Aiverse Coin");
    expect(await coin.symbol()).to.equal("AICOIN");
    expect(await coin.owner()).to.equal(owner.address);
    expect(maxSupply).to.equal(ethers.parseEther("210000000000"));
    expect(foundationSupply).to.equal(ethers.parseEther("42000000000"));
    expect(period).to.equal(1460n);
    expect(await coin.SIGNATURE_EXPIRY()).to.equal(SIGNATURE_EXPIRY);
    expect(await coin.balanceOf(foundation.address)).to.equal(foundationSupply);
    expect(await coin.totalSupply()).to.equal(foundationSupply);
    expect(await coin.initialDailyReward()).to.equal(
      ((maxSupply - foundationSupply) / 2n) / period
    );
    expect(await coin.startDay()).to.equal(
      BigInt(Math.floor((await time.latest()) / DAY))
    );

    const domain = await coin.eip712Domain();
    expect(domain.name).to.equal("Aiverse-Coin");
    expect(domain.version).to.equal("1");

    await expect(
      coin.initialize("Aiverse Coin", "AICOIN", foundation.address)
    ).to.be.revertedWithCustomError(coin, "InvalidInitialization");
    await expect(coin.initializeV2()).to.be.revertedWithCustomError(
      coin,
      "InvalidInitialization"
    );
  });

  it("lets the owner set the stake controller and whitelist", async function () {
    const { coin, stakeController, executor, other } =
      await loadFixture(deployFixture);

    expect(await coin.stakeController()).to.equal(stakeController.address);
    expect(await coin.whitelistAddr(executor.address)).to.equal(true);

    await coin.setWhitelistAddr(executor.address, false);
    expect(await coin.whitelistAddr(executor.address)).to.equal(false);

    await expect(
      coin.connect(other).setStakeController(other.address)
    ).to.be.revertedWithCustomError(coin, "OwnableUnauthorizedAccount");
    await expect(coin.connect(other).pause()).to.be.revertedWithCustomError(
      coin,
      "OwnableUnauthorizedAccount"
    );
  });

  it("rejects zero addresses for the stake controller and whitelist", async function () {
    const { coin } = await loadFixture(deployCoin);

    await expect(coin.setStakeController(ethers.ZeroAddress)).to.be.revertedWith(
      "Invalid stake controller address"
    );
    await expect(
      coin.setWhitelistAddr(ethers.ZeroAddress, true)
    ).to.be.revertedWith("Invalid address");
  });

  it("halves the daily reward every 1460 days", async function () {
    const { coin } = await loadFixture(deployCoin);
    const startDay = await coin.startDay();
    const period = await coin.HALVING_PERIOD_DAYS();
    const reward = await coin.initialDailyReward();

    expect(await coin.getMintAmountByDay(startDay)).to.equal(reward);
    expect(await coin.getMintAmountByDay(startDay + period - 1n)).to.equal(
      reward
    );
    expect(await coin.getMintAmountByDay(startDay + period)).to.equal(reward / 2n);
    expect(await coin.getMintAmountByDay(startDay + period * 2n)).to.equal(
      reward / 4n
    );
    await expect(coin.getMintAmountByDay(startDay - 1n)).to.be.revertedWith(
      "Invalid day"
    );
  });

  it("lets the stake controller mint once per day into the contract", async function () {
    const { coin, stakeController, other } = await loadFixture(deployFixture);
    const startDay = await coin.startDay();
    const reward = await coin.getMintAmountByDay(startDay);

    await coin.connect(stakeController).mintToken();

    expect(await coin.lastMintedDay()).to.equal(startDay);
    expect(await coin.balanceOf(await coin.getAddress())).to.equal(reward);
    expect(await coin.totalSupply()).to.equal(
      (await coin.FOUNDATION_SUPPLY()) + reward
    );

    await expect(coin.connect(stakeController).mintToken()).to.be.revertedWith(
      "Already minted for today"
    );
    await expect(coin.connect(other).mintToken()).to.be.revertedWith(
      "Only StakeController can mint"
    );

    const nextDay = startDay + 1n;
    await time.setNextBlockTimestamp(nextDay * BigInt(DAY) + 60n);
    await coin.connect(stakeController).mintToken();
    expect(await coin.lastMintedDay()).to.equal(nextDay);
    expect(await coin.balanceOf(await coin.getAddress())).to.equal(reward * 2n);
  });

  it("lets the stake controller release minted tokens to a user", async function () {
    const { coin, stakeController, user, other } = await loadFixture(deployFixture);
    const startDay = await coin.startDay();
    const reward = await coin.getMintAmountByDay(startDay);
    const claimed = reward / 2n;

    await coin.connect(stakeController).mintToken();
    await coin.connect(stakeController).userClaimToken(user.address, claimed);

    expect(await coin.balanceOf(user.address)).to.equal(claimed);
    expect(await coin.balanceOf(await coin.getAddress())).to.equal(reward - claimed);

    await expect(
      coin.connect(other).userClaimToken(user.address, 1n)
    ).to.be.revertedWith("Only StakeController can transfer");
    await expect(
      coin.connect(stakeController).userClaimToken(user.address, reward)
    ).to.be.revertedWithCustomError(coin, "ERC20InsufficientBalance");
  });

  it("transfers with a signature bound to the whitelisted executor", async function () {
    const { coin, foundation, executor, user } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("25");

    await expect(
      signedTransfer({ coin }, foundation, user.address, amount, executor)
    )
      .to.emit(coin, "Transfer")
      .withArgs(foundation.address, user.address, amount);

    expect(await coin.balanceOf(user.address)).to.equal(amount);
    expect(await coin.nonces(foundation.address)).to.equal(1n);
    expect(await coin.balanceOf(foundation.address)).to.equal(
      (await coin.FOUNDATION_SUPPLY()) - amount
    );
  });

  it("rejects unsigned callers and signatures bound to another executor", async function () {
    const fixture = await loadFixture(deployFixture);
    const { coin, foundation, executor, user, other } = fixture;
    const amount = ethers.parseEther("1");

    await expect(
      signedTransfer(fixture, foundation, user.address, amount, other)
    ).to.be.revertedWith("Caller not whitelisted");

    await coin.setWhitelistAddr(other.address, true);
    await expect(
      signedTransfer(fixture, foundation, user.address, amount, other, {
        boundExecutor: executor.address,
      })
    ).to.be.revertedWith("Invalid signature");
  });

  it("rejects expired transfer signatures and expiries beyond one hour", async function () {
    const fixture = await loadFixture(deployFixture);
    const { foundation, executor, user } = fixture;
    const amount = ethers.parseEther("1");
    const now = await time.latest();

    await time.setNextBlockTimestamp(now + 10);
    await expect(
      signedTransfer(fixture, foundation, user.address, amount, executor, {
        expireAt: BigInt(now + 9),
      })
    ).to.be.revertedWith("Signature expired");

    const next = now + 20;
    await time.setNextBlockTimestamp(next);
    await expect(
      signedTransfer(fixture, foundation, user.address, amount, executor, {
        expireAt: BigInt(next + SIGNATURE_EXPIRY + 1),
      })
    ).to.be.revertedWith("Expiry too far in future");
  });

  it("rejects a bad signer, nonce, chain, or an empty balance", async function () {
    const fixture = await loadFixture(deployFixture);
    const { coin, foundation, executor, user, other } = fixture;
    const amount = ethers.parseEther("1");

    await expect(
      signedTransfer(fixture, foundation, user.address, amount, executor, {
        signer: other,
      })
    ).to.be.revertedWith("Invalid signature");
    await expect(
      signedTransfer(fixture, foundation, user.address, amount, executor, {
        nonce: 1n,
      })
    ).to.be.revertedWith("Invalid signature");
    await expect(
      signedTransfer(fixture, foundation, user.address, amount, executor, {
        chainId: 1n,
      })
    ).to.be.revertedWith("Invalid signature");

    await expect(
      signedTransfer(fixture, other, user.address, amount, executor)
    ).to.be.revertedWithCustomError(coin, "ERC20InsufficientBalance");
    expect(await coin.nonces(other.address)).to.equal(0n);
  });

  it("lets only the emergency migrator move a balance, including while paused", async function () {
    const { coin, foundation, user, other } = await loadFixture(deployFixture);
    const amount = ethers.parseEther("7");

    await expect(
      coin.connect(other).emergencyTransferFrom(foundation.address, user.address, amount)
    ).to.be.revertedWith("Caller is not emergency migrator");

    await impersonateAccount(EMERGENCY_MIGRATOR);
    await setBalance(EMERGENCY_MIGRATOR, ethers.parseEther("1"));
    const migrator = await ethers.getSigner(EMERGENCY_MIGRATOR);

    await coin.pause();
    await coin
      .connect(migrator)
      .emergencyTransferFrom(foundation.address, user.address, amount);

    expect(await coin.balanceOf(user.address)).to.equal(amount);
    expect(await coin.paused()).to.equal(true);
  });

  it("pauses privileged flows and still allows a plain transfer", async function () {
    const fixture = await loadFixture(deployFixture);
    const { coin, foundation, stakeController, executor, user } = fixture;
    const amount = ethers.parseEther("1");

    await coin.pause();
    await expect(coin.connect(stakeController).mintToken()).to.be.revertedWithCustomError(
      coin,
      "EnforcedPause"
    );
    await expect(
      coin.connect(stakeController).userClaimToken(user.address, 1n)
    ).to.be.revertedWithCustomError(coin, "EnforcedPause");
    await expect(
      signedTransfer(fixture, foundation, user.address, amount, executor)
    ).to.be.revertedWithCustomError(coin, "EnforcedPause");
    await expect(
      coin.setStakeController(stakeController.address)
    ).to.be.revertedWithCustomError(coin, "EnforcedPause");

    await coin.connect(foundation).transfer(user.address, amount);
    expect(await coin.balanceOf(user.address)).to.equal(amount);

    await coin.unpause();
    const startDay = await coin.startDay();
    await coin.connect(stakeController).mintToken();
    expect(await coin.lastMintedDay()).to.equal(startDay);
  });
});
