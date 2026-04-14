// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

struct GenesisSeat {
    uint32 seatNo;
    uint64 paidAt;
    uint128 usdcPaid;
}

struct GenesisVesting {
    uint64 purchaseTime;
    uint64 firstClaimableAt;
    uint8 claimedPeriodsCount;
    uint8 delayPeriods;
}

contract AiverseFundV1_0_4 is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    IERC20 public aicoin;
    IERC20 public usdc;

    uint256 public minPurchaseAmount;
    uint256 public price;

    address public fundAddress;
    address public executorAddress;

    uint256 public totalSold;
    uint256 public totalUSDCReceived;

    uint256 public seatsFilled;
    mapping(address => GenesisSeat) public seatOf;
    mapping(address => GenesisVesting) public vestingOf;

    uint64 public globalFirstReleaseAt;

    uint256 public baseSeatPriceUsdc;

    uint256 public maxSeats;

    mapping(address => uint64) public lastVestingDelayBumpAt;

    uint256 public constant GENESIS_PERIODS = 12;
    uint256 public constant GENESIS_BATCH_SIZE = 10;
    uint256 public constant GENESIS_PERIOD_DURATION = 30 days;

    event FundAddressUpdated(
        address indexed oldAddress,
        address indexed newAddress
    );
    event ExecutorAddressUpdated(
        address indexed oldAddress,
        address indexed newAddress
    );
    event USDCWithdrawn(address indexed to, uint256 amount);
    event AICOINDeposited(address indexed from, uint256 amount);

    event GenesisSeatPurchased(
        address indexed buyer,
        uint256 seatNo,
        uint256 usdcAmount,
        uint256 totalAicoinScheduled,
        uint256 timestamp
    );
    event GenesisClaimed(address indexed user, uint256 amount);
    event GlobalFirstReleaseUpdated(uint64 oldTs, uint64 newTs);
    event BaseSeatPriceUsdcUpdated(uint256 oldPrice, uint256 newPrice);
    event MaxSeatsUpdated(uint256 oldMax, uint256 newMax);
    event VestingDelayIncreased(address indexed user, uint8 newDelayPeriods);

    modifier onlyOwnerOrExecutor() {
        require(
            msg.sender == owner() || msg.sender == executorAddress,
            "Not owner or executor"
        );
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _aicoinAddr,
        address _usdcAddr,
        uint256 _minPurchaseAmount,
        uint256 _price
    ) public virtual initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();

        require(_aicoinAddr != address(0), "Invalid AICOIN address");
        require(_usdcAddr != address(0), "Invalid USDC address");
        require(
            _minPurchaseAmount > 0,
            "Min purchase amount must be greater than 0"
        );
        require(_price > 0, "Price must be greater than 0");

        aicoin = IERC20(_aicoinAddr);
        usdc = IERC20(_usdcAddr);
        minPurchaseAmount = _minPurchaseAmount;
        price = _price;
    }

    function version() public pure returns (string memory) {
        return "1.0.4";
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function setFundAddress(address _fundAddress) external onlyOwner {
        require(_fundAddress != address(0), "Invalid fund address");
        address oldAddress = fundAddress;
        fundAddress = _fundAddress;
        emit FundAddressUpdated(oldAddress, _fundAddress);
    }

    function setExecutorAddress(address _executorAddress) external onlyOwner {
        address oldAddress = executorAddress;
        executorAddress = _executorAddress;
        emit ExecutorAddressUpdated(oldAddress, _executorAddress);
    }

    function setGlobalFirstReleaseAt(uint64 newTs) external onlyOwner {
        require(newTs >= block.timestamp, "T0 must not be in the past");
        require(seatsFilled == 0, "Cannot change T0 after seats sold");
        uint64 oldTs = globalFirstReleaseAt;
        globalFirstReleaseAt = newTs;
        emit GlobalFirstReleaseUpdated(oldTs, newTs);
    }

    function setBaseSeatPriceUsdc(uint256 newPrice) external onlyOwner {
        require(newPrice > 0, "Invalid base price");
        require(seatsFilled == 0, "Cannot change price after seats sold");
        uint256 oldPrice = baseSeatPriceUsdc;
        baseSeatPriceUsdc = newPrice;
        emit BaseSeatPriceUsdcUpdated(oldPrice, newPrice);
    }

    function setMaxSeats(uint256 newMax) external onlyOwner {
        require(newMax >= seatsFilled, "Below seats sold");
        uint256 oldMax = maxSeats;
        maxSeats = newMax;
        emit MaxSeatsUpdated(oldMax, newMax);
    }

    function increaseVestingDelay(address user) external onlyOwner {
        require(user != address(0), "Invalid user");
        GenesisVesting storage v = vestingOf[user];
        require(v.firstClaimableAt > 0, "No vesting");
        uint64 lastBump = lastVestingDelayBumpAt[user];
        if (lastBump != 0) {
            require(
                block.timestamp >= uint256(lastBump) + GENESIS_PERIOD_DURATION,
                "delay bump cooldown"
            );
        }
        require(v.delayPeriods < type(uint8).max, "delay overflow");
        unchecked {
            v.delayPeriods += 1;
        }
        lastVestingDelayBumpAt[user] = uint64(block.timestamp);
        emit VestingDelayIncreased(user, v.delayPeriods);
    }

    function depositAICOIN(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be greater than 0");
        aicoin.safeTransferFrom(msg.sender, address(this), amount);
        emit AICOINDeposited(msg.sender, amount);
    }

    function withdrawUSDC() external onlyOwner nonReentrant {
        uint256 balance = usdc.balanceOf(address(this));
        require(balance > 0, "No USDC to withdraw");
        usdc.safeTransfer(msg.sender, balance);
        emit USDCWithdrawn(msg.sender, balance);
    }

    function emergencyWithdrawToken(
        address tokenAddress
    ) external onlyOwner nonReentrant {
        require(tokenAddress != address(0), "Invalid token address");
        require(
            tokenAddress != address(aicoin),
            "AICOIN locked: vesting claims only"
        );
        IERC20 token = IERC20(tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");
        token.safeTransfer(msg.sender, balance);
    }

    function getAICOINBalance() public view returns (uint256) {
        return aicoin.balanceOf(address(this));
    }

    function getUSDCBalance() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function currentSeatPrice() public view returns (uint256) {
        uint256 batch = seatsFilled / GENESIS_BATCH_SIZE;
        require(baseSeatPriceUsdc > 0, "Base seat price not set");
        return (baseSeatPriceUsdc * _batchMultiplier(batch)) / 1e16;
    }

    function aicoinTotalForSeatNo(
        uint256 seatNo
    ) public pure returns (uint256) {
        if (seatNo == 1) return 150_000_000 * 1e18;
        if (seatNo == 2) return 140_000_000 * 1e18;
        if (seatNo == 3) return 130_000_000 * 1e18;
        if (seatNo >= 4 && seatNo <= 10) return 110_000_000 * 1e18;
        return 100_000_000 * 1e18;
    }

    function paySeatWithPermit(
        address buyer,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused onlyOwnerOrExecutor {
        require(fundAddress != address(0), "Fund address not set");
        require(buyer != address(0), "Invalid buyer");
        uint256 seatPrice = currentSeatPrice();
        require(deadline >= block.timestamp, "Permit expired");

        IERC20Permit(address(usdc)).permit(
            buyer,
            address(this),
            seatPrice,
            deadline,
            v,
            r,
            s
        );
        _paySeat(buyer, seatPrice);
    }

    function globalUnlockTime(uint8 period) public view returns (uint256) {
        require(period < GENESIS_PERIODS, "Invalid period");
        require(globalFirstReleaseAt > 0, "T0 not set");
        return
            uint256(globalFirstReleaseAt) +
            uint256(period) *
            GENESIS_PERIOD_DURATION;
    }

    function trancheAmount(
        uint128 total,
        uint8 period
    ) public pure returns (uint128) {
        require(period < GENESIS_PERIODS, "Invalid period");
        uint256 t = uint256(total);
        uint256 base = t / GENESIS_PERIODS;
        if (uint256(period) == GENESIS_PERIODS - 1) {
            return uint128(t - base * (GENESIS_PERIODS - 1));
        }
        return uint128(base);
    }

    function claimable(address user) public view returns (uint256) {
        GenesisVesting storage v = vestingOf[user];
        if (v.firstClaimableAt == 0) return 0;
        uint128 total = _vestingTotalAicoin(user);
        (uint256 sum, ) = _sumUnlockedTranches(
            v.firstClaimableAt,
            v.delayPeriods,
            v.claimedPeriodsCount,
            total
        );
        return sum;
    }

    function claim() external nonReentrant whenNotPaused {
        _claimVesting(msg.sender);
    }

    function claimFor(
        address user
    ) external nonReentrant whenNotPaused onlyOwnerOrExecutor {
        require(user != address(0), "Invalid user");
        _claimVesting(user);
    }

    function _paySeat(address buyer, uint256 usdcAmount) internal {
        require(maxSeats > 0, "Max seats not set");
        require(seatsFilled < maxSeats, "Sold out");
        require(seatOf[buyer].seatNo == 0, "Already purchased");
        require(usdcAmount > 0, "Invalid USDC amount");
        require(globalFirstReleaseAt > 0, "T0 not set");

        uint256 seatNo = seatsFilled + 1;
        uint256 totalReward = aicoinTotalForSeatNo(seatNo);
        require(totalReward <= type(uint128).max, "Reward too large");
        require(
            aicoin.balanceOf(address(this)) >= totalReward,
            "Insufficient AICOIN in contract"
        );

        seatsFilled = seatNo;
        totalUSDCReceived += usdcAmount;

        seatOf[buyer] = GenesisSeat({
            seatNo: uint32(seatNo),
            paidAt: uint64(block.timestamp),
            usdcPaid: uint128(usdcAmount)
        });

        vestingOf[buyer] = GenesisVesting({
            purchaseTime: uint64(block.timestamp),
            firstClaimableAt: _firstClaimableAtForPurchase(
                block.timestamp,
                globalFirstReleaseAt
            ),
            claimedPeriodsCount: 0,
            delayPeriods: 0
        });

        emit GenesisSeatPurchased(
            buyer,
            seatNo,
            usdcAmount,
            totalReward,
            block.timestamp
        );

        usdc.safeTransferFrom(buyer, fundAddress, usdcAmount);
    }

    function _firstClaimableAtForPurchase(
        uint256 purchaseTs,
        uint64 t0
    ) internal pure returns (uint64) {
        uint256 t0u = uint256(t0);
        if (purchaseTs < t0u) {
            uint256 timeToT0 = t0u - purchaseTs;
            if (timeToT0 > GENESIS_PERIOD_DURATION) {
                return t0;
            }
            uint256 firstAtEarly = t0u + GENESIS_PERIOD_DURATION;
            require(firstAtEarly <= type(uint64).max, "first claim overflow");
            return uint64(firstAtEarly);
        }
        uint256 currentPeriod = (purchaseTs - t0u) / GENESIS_PERIOD_DURATION;
        uint256 firstGlobalPeriod = currentPeriod + 2;
        uint256 firstAt = t0u + firstGlobalPeriod * GENESIS_PERIOD_DURATION;
        require(firstAt <= type(uint64).max, "first claim overflow");
        return uint64(firstAt);
    }

    function _isPeriodUnlocked(
        uint64 firstAt,
        uint8 delayPeriods,
        uint8 p
    ) internal view returns (bool) {
        if (firstAt == 0) return false;
        return
            block.timestamp >=
            uint256(firstAt) +
                (uint256(delayPeriods) + uint256(p)) *
                GENESIS_PERIOD_DURATION;
    }

    function _vestingTotalAicoin(address user) internal view returns (uint128) {
        uint32 seatNo = seatOf[user].seatNo;
        require(seatNo > 0, "No seat");
        uint256 t = aicoinTotalForSeatNo(uint256(seatNo));
        require(t <= type(uint128).max, "total");
        return uint128(t);
    }

    function _sumUnlockedTranches(
        uint64 firstClaimableAt,
        uint8 delayPeriods,
        uint8 startPeriod,
        uint128 totalAicoin
    ) internal view returns (uint256 amount, uint8 nextPeriod) {
        uint8 p = startPeriod;
        uint256 sum = 0;
        for (; p < uint8(GENESIS_PERIODS); ) {
            if (!_isPeriodUnlocked(firstClaimableAt, delayPeriods, p)) {
                break;
            }
            sum += trancheAmount(totalAicoin, p);
            unchecked {
                ++p;
            }
        }
        return (sum, p);
    }

    function _claimVesting(address user) internal {
        GenesisVesting storage v = vestingOf[user];
        require(v.firstClaimableAt > 0, "No vesting");

        uint128 total = _vestingTotalAicoin(user);
        (uint256 sum, uint8 nextPeriod) = _sumUnlockedTranches(
            v.firstClaimableAt,
            v.delayPeriods,
            v.claimedPeriodsCount,
            total
        );

        require(sum > 0, "Nothing to claim");
        v.claimedPeriodsCount = nextPeriod;
        require(aicoin.balanceOf(address(this)) >= sum, "Insufficient AICOIN");
        aicoin.safeTransfer(user, sum);
        emit GenesisClaimed(user, sum);
    }

    function _batchMultiplier(uint256 batch) internal pure returns (uint256) {
        if (batch == 0) return 10_000_000_000_000_000;
        if (batch == 1) return 11_000_000_000_000_000;
        if (batch == 2) return 12_100_000_000_000_000;
        if (batch == 3) return 13_310_000_000_000_000;
        if (batch == 4) return 14_641_000_000_000_000;
        if (batch == 5) return 16_105_100_000_000_000;
        if (batch == 6) return 17_715_610_000_000_000;
        if (batch == 7) return 19_487_171_000_000_000;
        if (batch == 8) return 21_435_888_100_000_000;
        if (batch == 9) return 23_579_476_910_000_000;
        if (batch == 10) return 25_937_424_601_000_000;
        if (batch == 11) return 28_531_167_061_100_000;
        if (batch == 12) return 31_384_283_767_210_000;
        if (batch == 13) return 34_522_712_143_931_000;
        if (batch == 14) return 37_974_983_358_324_100;
        if (batch == 15) return 41_772_481_694_156_510;
        if (batch == 16) return 45_949_729_863_572_161;
        revert("Invalid batch");
    }

    receive() external payable {
        revert("Direct ETH transfers not allowed");
    }

    fallback() external payable {
        revert("Fallback not allowed");
    }
}
