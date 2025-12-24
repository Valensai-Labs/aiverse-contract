// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract AiverseFundV1 is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    IERC20 public aicoin;
    IERC20 public usdt;

    uint256 public minPurchaseAmount; // 最低购买量（AICOIN，18 decimals）

    // 价格：1个AICOIN对应多少USDT（以USDT最小单位计价，USDT是6 decimals）
    // 例如：如果1 AICOIN = 0.001 USDT，则 price = 1000
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

        require(
            aicoin.transferFrom(msg.sender, address(this), amount),
            "AICOIN transfer failed"
        );

        emit AICOINDeposited(msg.sender, amount);
    }

    /**
     * @dev 用户购买 AICOIN（只接受 USDT 支付）
     * @param usdtAmount 要支付的 USDT 数量（购买的 AICOIN 必须 >= minPurchaseAmount）
     */
    function purchaseWithUSDT(
        uint256 usdtAmount
    ) external nonReentrant whenNotPaused {
        // 计算能购买的 AICOIN 数量
        // USDT是6位小数，AICOIN是18位小数，需要乘以1e18转换精度
        uint256 aicoinAmount = (usdtAmount * 1e18) / price;

        // 检查是否达到最低购买量
        require(
            aicoinAmount >= minPurchaseAmount,
            "Below minimum purchase amount"
        );

        // 检查合约中 AICOIN 余额是否充足
        uint256 contractBalance = aicoin.balanceOf(address(this));
        require(
            contractBalance >= aicoinAmount,
            "Insufficient AICOIN in contract"
        );

        // 检查用户的 USDT 授权额度
        uint256 usdtAllowance = usdt.allowance(msg.sender, address(this));
        require(usdtAllowance >= usdtAmount, "Insufficient USDT allowance");

        // 检查用户的 USDT 余额
        uint256 userUSDTBalance = usdt.balanceOf(msg.sender);
        require(userUSDTBalance >= usdtAmount, "Insufficient USDT balance");

        // 转入 USDT
        require(
            usdt.transferFrom(msg.sender, address(this), usdtAmount),
            "USDT transfer failed"
        );

        // 转出 AICOIN
        require(
            aicoin.transfer(msg.sender, aicoinAmount),
            "AICOIN transfer failed"
        );

        // 更新统计数据
        totalSold += aicoinAmount;
        totalUSDTReceived += usdtAmount;

        emit TokensPurchased(
            msg.sender,
            aicoinAmount,
            usdtAmount,
            block.timestamp
        );
    }

    /**
     * @dev 项目方提取所有 USDT
     */
    function withdrawUSDT() external onlyOwner nonReentrant {
        uint256 balance = usdt.balanceOf(address(this));
        require(balance > 0, "No USDT to withdraw");

        require(usdt.transfer(msg.sender, balance), "USDT withdrawal failed");

        emit USDTWithdrawn(msg.sender, balance);
    }

    /**
     * @dev 项目方提取所有剩余的 AICOIN（例如销售结束后）
     */
    function withdrawAICOIN() external onlyOwner nonReentrant {
        uint256 balance = aicoin.balanceOf(address(this));
        require(balance > 0, "No AICOIN to withdraw");

        require(
            aicoin.transfer(msg.sender, balance),
            "AICOIN withdrawal failed"
        );

        emit AICOINWithdrawn(msg.sender, balance);
    }

    /**
     * @dev 紧急提取任意 ERC20 代币（防止用户误转其他代币）
     * @param tokenAddress 代币地址
     */
    function emergencyWithdrawToken(
        address tokenAddress
    ) external onlyOwner nonReentrant {
        require(tokenAddress != address(0), "Invalid token address");

        IERC20 token = IERC20(tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");

        require(token.transfer(msg.sender, balance), "Token withdrawal failed");
    }

    // ============ 查询函数 ============

    /**
     * @dev 获取合约中 AICOIN 余额
     */
    function getAICOINBalance() external view returns (uint256) {
        return aicoin.balanceOf(address(this));
    }

    /**
     * @dev 获取合约中 USDT 余额
     */
    function getUSDTBalance() external view returns (uint256) {
        return usdt.balanceOf(address(this));
    }

    /**
     * @dev 检查用户的 USDT 授权额度
     * @param user 用户地址
     */
    function getUserUSDTAllowance(
        address user
    ) external view returns (uint256) {
        return usdt.allowance(user, address(this));
    }

    /**
     * @dev 检查用户的 USDT 余额
     * @param user 用户地址
     */
    function getUserUSDTBalance(address user) external view returns (uint256) {
        return usdt.balanceOf(user);
    }

    /**
     * @dev 计算指定 USDT 数量能购买多少 AICOIN
     * @param usdtAmount USDT 数量（6 decimals）
     * @return AICOIN 数量（18 decimals）
     */
    function calculateAICOINAmount(
        uint256 usdtAmount
    ) external view returns (uint256) {
        return (usdtAmount * 1e18) / price;
    }

    /**
     * @dev 检查用户是否可以用指定的 USDT 购买 AICOIN
     * @param user 用户地址
     * @param usdtAmount USDT 数量（6 decimals）
     * @return canPurchase 是否可以购买
     * @return reason 不能购买的原因（如果可以购买则为空字符串）
     */
    function canUserPurchase(
        address user,
        uint256 usdtAmount
    ) external view returns (bool canPurchase, string memory reason) {
        uint256 aicoinAmount = (usdtAmount * 1e18) / price;

        if (aicoinAmount < minPurchaseAmount) {
            return (false, "Below minimum purchase amount");
        }

        uint256 contractBalance = aicoin.balanceOf(address(this));
        if (contractBalance < aicoinAmount) {
            return (false, "Insufficient AICOIN in contract");
        }

        uint256 usdtAllowance = usdt.allowance(user, address(this));
        if (usdtAllowance < usdtAmount) {
            return (false, "Insufficient USDT allowance");
        }

        uint256 userUSDTBalance = usdt.balanceOf(user);
        if (userUSDTBalance < usdtAmount) {
            return (false, "Insufficient USDT balance");
        }

        return (true, "");
    }

    /**
     * @dev 防止直接接收 ETH
     */
    receive() external payable {
        revert("Direct ETH transfers not allowed");
    }

    fallback() external payable {
        revert("Fallback not allowed");
    }
}
