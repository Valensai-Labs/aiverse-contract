// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract AiverseFundV1_0_1 is
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

    uint256 public totalSold;
    uint256 public totalUSDCReceived;

    event TokensPurchased(
        address indexed buyer,
        uint256 aicoinAmount,
        uint256 usdcAmount,
        uint256 timestamp
    );
    event PriceUpdated(uint256 oldPrice, uint256 newPrice);
    event USDCWithdrawn(address indexed to, uint256 amount);
    event AICOINWithdrawn(address indexed to, uint256 amount);
    event AICOINDeposited(address indexed from, uint256 amount);

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
        return "1.0.1";
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

    function purchaseWithUSDC(
        uint256 usdcAmount
    ) external nonReentrant whenNotPaused {
        _checkAndExecutePurchase(msg.sender, usdcAmount, true);
    }

    function purchaseWithPermit(
        address buyer,
        uint256 usdcAmount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant whenNotPaused onlyOwner {
        IERC20Permit(address(usdc)).permit(
            buyer,
            address(this),
            usdcAmount,
            deadline,
            v,
            r,
            s
        );
        _checkAndExecutePurchase(buyer, usdcAmount, false);
    }

    function withdrawUSDC() external onlyOwner nonReentrant {
        uint256 balance = usdc.balanceOf(address(this));
        require(balance > 0, "No USDC to withdraw");
        usdc.safeTransfer(msg.sender, balance);
        emit USDCWithdrawn(msg.sender, balance);
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

    function getUSDCBalance() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function getUserUSDCAllowance(address user) public view returns (uint256) {
        return usdc.allowance(user, address(this));
    }

    function getUserUSDCBalance(address user) public view returns (uint256) {
        return usdc.balanceOf(user);
    }

    function calculateAICOINAmount(
        uint256 usdcAmount
    ) public view returns (uint256) {
        return (usdcAmount * 1e18) / price;
    }

    function calculateUSDCAmount(
        uint256 aicoinAmount
    ) public view returns (uint256) {
        return (aicoinAmount * price) / 1e18;
    }

    function getMaxAcceptableUSDC() public view returns (uint256) {
        return calculateUSDCAmount(getAICOINBalance());
    }

    function canUserPurchase(
        address user,
        uint256 usdcAmount
    )
        public
        view
        returns (bool canPurchase, string memory reason, uint256 aicoinAmount)
    {
        return _canUserPurchase(user, usdcAmount, true);
    }

    function _canUserPurchase(
        address user,
        uint256 usdcAmount,
        bool checkAllowance
    )
        internal
        view
        returns (bool canPurchase, string memory reason, uint256 aicoinAmount)
    {
        aicoinAmount = calculateAICOINAmount(usdcAmount);

        if (aicoinAmount < minPurchaseAmount) {
            return (false, "Below minimum purchase amount", 0);
        }

        if (getAICOINBalance() < aicoinAmount) {
            return (false, "Insufficient AICOIN in contract", 0);
        }

        if (checkAllowance && getUserUSDCAllowance(user) < usdcAmount) {
            return (false, "Insufficient USDC allowance", 0);
        }

        if (getUserUSDCBalance(user) < usdcAmount) {
            return (false, "Insufficient USDC balance", 0);
        }

        return (true, "", aicoinAmount);
    }

    function _checkAndExecutePurchase(
        address buyer,
        uint256 usdcAmount,
        bool checkAllowance
    ) internal {
        (
            bool canPurchase,
            string memory reason,
            uint256 aicoinAmount
        ) = _canUserPurchase(buyer, usdcAmount, checkAllowance);
        require(canPurchase, reason);

        totalSold += aicoinAmount;
        totalUSDCReceived += usdcAmount;

        usdc.safeTransferFrom(buyer, address(this), usdcAmount);
        aicoin.safeTransfer(buyer, aicoinAmount);

        emit TokensPurchased(buyer, aicoinAmount, usdcAmount, block.timestamp);
    }

    receive() external payable {
        revert("Direct ETH transfers not allowed");
    }

    fallback() external payable {
        revert("Fallback not allowed");
    }
}
