// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract AiverseFund is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    IERC20 public aicoin;
    IERC20 public usdt;

    uint256 public minPurchaseAmount;
    uint256 public price;

    uint256 public totalSold;
    uint256 public totalUSDTReceived;

    event TokensPurchased(
        address indexed buyer,
        uint256 aicoinAmount,
        uint256 usdtAmount,
        uint256 timestamp
    );
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);
    event USDTWithdrawn(address indexed to, uint256 amount);
    event AICOINWithdrawn(address indexed to, uint256 amount);
    event AICOINDeposited(address indexed from, uint256 amount);

    function initialize(
        address _aicoinAddr,
        address _usdtAddr,
        uint256 _minPurchaseAmount,
        uint256 _price
    ) public virtual initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();

        require(_aicoinAddr != address(0), "Invalid AICOIN address");
        require(_usdtAddr != address(0), "Invalid USDT address");
        require(
            _minPurchaseAmount > 0,
            "Min purchase amount must be greater than 0"
        );
        require(_price > 0, "Price must be greater than 0");

        aicoin = IERC20(_aicoinAddr);
        usdt = IERC20(_usdtAddr);
        minPurchaseAmount = _minPurchaseAmount;
        price = _price;
    }

    function version() public pure returns (string memory) {
        return "1.0.0";
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function setMinPurchaseAmount(
        uint256 _minPurchaseAmount
    ) external onlyOwner {
        require(
            _minPurchaseAmount > 0,
            "Min purchase amount must be greater than 0"
        );
        minPurchaseAmount = _minPurchaseAmount;
    }

    function setPrice(uint256 _price) external onlyOwner {
        require(_price > 0, "Price must be greater than 0");
        uint256 oldPrice = price;
        price = _price;
        emit PriceUpdated(oldPrice, _price);
    }

    function depositAICOIN(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be greater than 0");

        uint256 allowance = aicoin.allowance(msg.sender, address(this));
        require(allowance >= amount, "Insufficient AICOIN allowance");

        aicoin.safeTransferFrom(msg.sender, address(this), amount);

        emit AICOINDeposited(msg.sender, amount);
    }

    function purchaseWithUSDT(
        uint256 usdtAmount
    ) external nonReentrant whenNotPaused {
        (
            bool canPurchase,
            string memory reason,
            uint256 aicoinAmount
        ) = canUserPurchase(msg.sender, usdtAmount);
        require(canPurchase, reason);

        totalSold += aicoinAmount;
        totalUSDTReceived += usdtAmount;

        usdt.safeTransferFrom(msg.sender, address(this), usdtAmount);
        aicoin.safeTransfer(msg.sender, aicoinAmount);

        emit TokensPurchased(
            msg.sender,
            aicoinAmount,
            usdtAmount,
            block.timestamp
        );
    }

    function withdrawUSDT() external onlyOwner nonReentrant {
        uint256 balance = usdt.balanceOf(address(this));
        require(balance > 0, "No USDT to withdraw");
        usdt.safeTransfer(msg.sender, balance);
        emit USDTWithdrawn(msg.sender, balance);
    }

    function withdrawAICOIN() external onlyOwner nonReentrant {
        uint256 balance = aicoin.balanceOf(address(this));
        require(balance > 0, "No AICOIN to withdraw");
        aicoin.safeTransfer(msg.sender, balance);
        emit AICOINWithdrawn(msg.sender, balance);
    }

    function emergencyWithdrawToken(
        address tokenAddress
    ) external onlyOwner nonReentrant {
        require(tokenAddress != address(0), "Invalid token address");
        IERC20 token = IERC20(tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");
        token.safeTransfer(msg.sender, balance);
    }

    function getAICOINBalance() public view returns (uint256) {
        return aicoin.balanceOf(address(this));
    }

    function getUSDTBalance() public view returns (uint256) {
        return usdt.balanceOf(address(this));
    }

    function getUserUSDTAllowance(address user) public view returns (uint256) {
        return usdt.allowance(user, address(this));
    }

    function getUserUSDTBalance(address user) public view returns (uint256) {
        return usdt.balanceOf(user);
    }

    function calculateAICOINAmount(
        uint256 usdtAmount
    ) public view returns (uint256) {
        return (usdtAmount * 1e18) / price;
    }

    function calculateUSDTAmount(
        uint256 aicoinAmount
    ) public view returns (uint256) {
        return (aicoinAmount * price) / 1e18;
    }

    function getMaxAcceptableUSDT() public view returns (uint256) {
        return calculateUSDTAmount(getAICOINBalance());
    }

    function canUserPurchase(
        address user,
        uint256 usdtAmount
    )
        public
        view
        returns (bool canPurchase, string memory reason, uint256 aicoinAmount)
    {
        aicoinAmount = calculateAICOINAmount(usdtAmount);

        if (aicoinAmount < minPurchaseAmount) {
            return (false, "Below minimum purchase amount", 0);
        }

        if (getAICOINBalance() < aicoinAmount) {
            return (false, "Insufficient AICOIN in contract", 0);
        }

        if (getUserUSDTAllowance(user) < usdtAmount) {
            return (false, "Insufficient USDT allowance", 0);
        }

        if (getUserUSDTBalance(user) < usdtAmount) {
            return (false, "Insufficient USDT balance", 0);
        }

        return (true, "", aicoinAmount);
    }

    receive() external payable {
        revert("Direct ETH transfers not allowed");
    }

    fallback() external payable {
        revert("Fallback not allowed");
    }
}
