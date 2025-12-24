// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);

    function balanceOf(address account) external view returns (uint256);

    function allowance(
        address owner,
        address spender
    ) external view returns (uint256);

    function decimals() external view returns (uint8);
}

contract AiverseFundV1 is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    IERC20 public aicoin;
    IERC20 public usdt;

    uint256 public constant MIN_PURCHASE_AMOUNT = 10_000_000 * 10 ** 18; // 1000万 AICOIN (假设18位小数)

    // 价格：1000万 AICOIN 对应多少 USDT (USDT通常是6位小数)
    uint256 public pricePerBatch; // 例如: 10000 * 10**6 表示 1000万AICOIN = 10000 USDT

    uint256 public totalSold;
    uint256 public totalUSDTReceived;

    mapping(address => uint256) public userPurchased;
    mapping(address => uint256) public userUSDTPaid;

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
        uint256 _pricePerBatch
    ) public virtual initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();

        require(_aicoinAddr != address(0), "Invalid AICOIN address");
        require(_usdtAddr != address(0), "Invalid USDT address");
        require(_aicoinAddr != _usdtAddr, "AICOIN and USDT must be different");
        require(_pricePerBatch > 0, "Price must be greater than 0");

        aicoin = IERC20(_aicoinAddr);
        usdt = IERC20(_usdtAddr);
        pricePerBatch = _pricePerBatch;
    }

    function version() public pure returns (string memory) {
        return "1";
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    /**
     * @dev 设置价格（1000万 AICOIN 对应的 USDT 数量）
     * @param _pricePerBatch 新价格（USDT数量，注意小数位）
     */
    function setPricePerBatch(uint256 _pricePerBatch) external onlyOwner {
        require(_pricePerBatch > 0, "Price must be greater than 0");
        uint256 oldPrice = pricePerBatch;
        pricePerBatch = _pricePerBatch;
        emit PriceUpdated(oldPrice, _pricePerBatch);
    }

    /**
     * @dev 项目方存入 AICOIN 代币
     * @param amount 存入数量
     */
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
     * @param aicoinAmount 要购买的 AICOIN 数量（必须是 MIN_PURCHASE_AMOUNT 的整数倍）
     */
    function purchaseWithUSDT(
        uint256 aicoinAmount
    ) external nonReentrant whenNotPaused {
        require(
            aicoinAmount >= MIN_PURCHASE_AMOUNT,
            "Below minimum purchase amount"
        );
        require(
            aicoinAmount % MIN_PURCHASE_AMOUNT == 0,
            "Amount must be multiple of minimum"
        );

        // 计算需要支付的 USDT 数量
        uint256 batches = aicoinAmount / MIN_PURCHASE_AMOUNT;
        uint256 usdtRequired = batches * pricePerBatch;
        require(usdtRequired > 0, "Invalid USDT amount");

        // 检查合约中 AICOIN 余额是否充足
        uint256 contractBalance = aicoin.balanceOf(address(this));
        require(
            contractBalance >= aicoinAmount,
            "Insufficient AICOIN in contract"
        );

        // 检查用户的 USDT 授权额度
        uint256 usdtAllowance = usdt.allowance(msg.sender, address(this));
        require(usdtAllowance >= usdtRequired, "Insufficient USDT allowance");

        // 检查用户的 USDT 余额
        uint256 userUSDTBalance = usdt.balanceOf(msg.sender);
        require(userUSDTBalance >= usdtRequired, "Insufficient USDT balance");

        // 转入 USDT
        require(
            usdt.transferFrom(msg.sender, address(this), usdtRequired),
            "USDT transfer failed"
        );

        // 转出 AICOIN
        require(
            aicoin.transfer(msg.sender, aicoinAmount),
            "AICOIN transfer failed"
        );

        // 更新统计数据
        userPurchased[msg.sender] += aicoinAmount;
        userUSDTPaid[msg.sender] += usdtRequired;
        totalSold += aicoinAmount;
        totalUSDTReceived += usdtRequired;

        emit TokensPurchased(
            msg.sender,
            aicoinAmount,
            usdtRequired,
            block.timestamp
        );
    }

    /**
     * @dev 项目方提取 USDT
     * @param amount 提取数量（0 表示全部提取）
     */
    function withdrawUSDT(uint256 amount) external onlyOwner nonReentrant {
        uint256 balance = usdt.balanceOf(address(this));
        require(balance > 0, "No USDT to withdraw");

        uint256 withdrawAmount = amount == 0 ? balance : amount;
        require(withdrawAmount <= balance, "Insufficient USDT balance");

        require(
            usdt.transfer(msg.sender, withdrawAmount),
            "USDT withdrawal failed"
        );

        emit USDTWithdrawn(msg.sender, withdrawAmount);
    }

    /**
     * @dev 项目方提取剩余的 AICOIN（例如销售结束后）
     * @param amount 提取数量（0 表示全部提取）
     */
    function withdrawAICOIN(uint256 amount) external onlyOwner nonReentrant {
        uint256 balance = aicoin.balanceOf(address(this));
        require(balance > 0, "No AICOIN to withdraw");

        uint256 withdrawAmount = amount == 0 ? balance : amount;
        require(withdrawAmount <= balance, "Insufficient AICOIN balance");

        require(
            aicoin.transfer(msg.sender, withdrawAmount),
            "AICOIN withdrawal failed"
        );

        emit AICOINWithdrawn(msg.sender, withdrawAmount);
    }

    /**
     * @dev 紧急提取任意 ERC20 代币（防止用户误转其他代币）
     * @param tokenAddress 代币地址
     * @param amount 提取数量（0 表示全部提取）
     */
    function emergencyWithdrawToken(
        address tokenAddress,
        uint256 amount
    ) external onlyOwner nonReentrant {
        require(tokenAddress != address(0), "Invalid token address");

        IERC20 token = IERC20(tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");

        uint256 withdrawAmount = amount == 0 ? balance : amount;
        require(withdrawAmount <= balance, "Insufficient token balance");

        require(
            token.transfer(msg.sender, withdrawAmount),
            "Token withdrawal failed"
        );
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
     * @dev 计算购买指定数量 AICOIN 需要支付的 USDT
     * @param aicoinAmount AICOIN 数量
     */
    function calculateUSDTRequired(
        uint256 aicoinAmount
    ) external view returns (uint256) {
        require(
            aicoinAmount >= MIN_PURCHASE_AMOUNT,
            "Below minimum purchase amount"
        );
        require(
            aicoinAmount % MIN_PURCHASE_AMOUNT == 0,
            "Amount must be multiple of minimum"
        );

        uint256 batches = aicoinAmount / MIN_PURCHASE_AMOUNT;
        return batches * pricePerBatch;
    }

    /**
     * @dev 检查用户是否可以购买指定数量的 AICOIN
     * @param user 用户地址
     * @param aicoinAmount AICOIN 数量
     * @return canPurchase 是否可以购买
     * @return reason 不能购买的原因（如果可以购买则为空字符串）
     */
    function canUserPurchase(
        address user,
        uint256 aicoinAmount
    ) external view returns (bool canPurchase, string memory reason) {
        if (aicoinAmount < MIN_PURCHASE_AMOUNT) {
            return (false, "Below minimum purchase amount");
        }

        if (aicoinAmount % MIN_PURCHASE_AMOUNT != 0) {
            return (false, "Amount must be multiple of minimum");
        }

        uint256 contractBalance = aicoin.balanceOf(address(this));
        if (contractBalance < aicoinAmount) {
            return (false, "Insufficient AICOIN in contract");
        }

        uint256 batches = aicoinAmount / MIN_PURCHASE_AMOUNT;
        uint256 usdtRequired = batches * pricePerBatch;

        uint256 usdtAllowance = usdt.allowance(user, address(this));
        if (usdtAllowance < usdtRequired) {
            return (false, "Insufficient USDT allowance");
        }

        uint256 userUSDTBalance = usdt.balanceOf(user);
        if (userUSDTBalance < usdtRequired) {
            return (false, "Insufficient USDT balance");
        }

        return (true, "");
    }

    /**
     * @dev 获取用户购买统计
     * @param user 用户地址
     */
    function getUserStats(
        address user
    ) external view returns (uint256 purchased, uint256 usdtPaid) {
        return (userPurchased[user], userUSDTPaid[user]);
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
