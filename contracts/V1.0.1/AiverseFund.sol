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

    /// @custom:oz-upgrades-unsafe-allow constructor
    /// @dev Disables initializers to prevent implementation contract from being initialized
    constructor() {
        _disableInitializers();
    }

    /**
     * @dev Initializes the contract with token addresses and sale parameters
     * @param _aicoinAddr The address of the AICOIN token contract
     * @param _usdcAddr The address of the USDC token contract
     * @param _minPurchaseAmount The minimum amount of AICOIN that can be purchased per transaction
     * @param _price The price of 1 AICOIN in USDC (scaled by 1e18)
     */
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

    /**
     * @dev Returns the current version of the contract
     * @return The version string
     */
    function version() public pure returns (string memory) {
        return "1.0.1";
    }

    /**
     * @dev Pauses all token purchase operations. Only callable by owner.
     */
    function pause() public onlyOwner {
        _pause();
    }

    /**
     * @dev Unpauses all token purchase operations. Only callable by owner.
     */
    function unpause() public onlyOwner {
        _unpause();
    }

    /**
     * @dev Updates the minimum purchase amount. Only callable by owner.
     * @param _minPurchaseAmount The new minimum AICOIN purchase amount
     */
    function setMinPurchaseAmount(
        uint256 _minPurchaseAmount
    ) external onlyOwner {
        require(
            _minPurchaseAmount > 0,
            "Min purchase amount must be greater than 0"
        );
        minPurchaseAmount = _minPurchaseAmount;
    }

    /**
     * @dev Updates the AICOIN price in USDC. Only callable by owner.
     * @param _price The new price of 1 AICOIN in USDC (scaled by 1e18)
     */
    function setPrice(uint256 _price) external onlyOwner {
        require(_price > 0, "Price must be greater than 0");
        uint256 oldPrice = price;
        price = _price;
        emit PriceUpdated(oldPrice, _price);
    }

    /**
     * @dev Deposits AICOIN tokens into the contract for sale. Only callable by owner.
     * @param amount The amount of AICOIN to deposit
     */
    function depositAICOIN(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "Amount must be greater than 0");

        uint256 allowance = aicoin.allowance(msg.sender, address(this));
        require(allowance >= amount, "Insufficient AICOIN allowance");

        aicoin.safeTransferFrom(msg.sender, address(this), amount);

        emit AICOINDeposited(msg.sender, amount);
    }

    /**
     * @dev Allows users to purchase AICOIN tokens using USDC. Requires prior USDC approval.
     * @param usdcAmount The amount of USDC to spend
     */
    function purchaseWithUSDC(
        uint256 usdcAmount
    ) external nonReentrant whenNotPaused {
        _checkAndExecutePurchase(msg.sender, usdcAmount, true);
    }

    /**
     * @dev Allows owner to execute a purchase on behalf of a buyer using EIP-2612 permit.
     * @param buyer The address of the buyer who signed the permit
     * @param usdcAmount The amount of USDC to spend
     * @param deadline The deadline timestamp for the permit signature
     * @param v The recovery byte of the signature
     * @param r Half of the ECDSA signature pair
     * @param s Half of the ECDSA signature pair
     */
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

    /**
     * @dev Withdraws all USDC from the contract to the owner. Only callable by owner.
     */
    function withdrawUSDC() external onlyOwner nonReentrant {
        uint256 balance = usdc.balanceOf(address(this));
        require(balance > 0, "No USDC to withdraw");
        usdc.safeTransfer(msg.sender, balance);
        emit USDCWithdrawn(msg.sender, balance);
    }

    /**
     * @dev Withdraws all AICOIN from the contract to the owner. Only callable by owner.
     */
    function withdrawAICOIN() external onlyOwner nonReentrant {
        uint256 balance = aicoin.balanceOf(address(this));
        require(balance > 0, "No AICOIN to withdraw");
        aicoin.safeTransfer(msg.sender, balance);
        emit AICOINWithdrawn(msg.sender, balance);
    }

    /**
     * @dev Emergency function to withdraw any ERC20 token from the contract. Only callable by owner.
     * @param tokenAddress The address of the token to withdraw
     */
    function emergencyWithdrawToken(
        address tokenAddress
    ) external onlyOwner nonReentrant {
        require(tokenAddress != address(0), "Invalid token address");
        IERC20 token = IERC20(tokenAddress);
        uint256 balance = token.balanceOf(address(this));
        require(balance > 0, "No tokens to withdraw");
        token.safeTransfer(msg.sender, balance);
    }

    /**
     * @dev Returns the AICOIN balance held by this contract
     * @return The amount of AICOIN tokens in the contract
     */
    function getAICOINBalance() public view returns (uint256) {
        return aicoin.balanceOf(address(this));
    }

    /**
     * @dev Returns the USDC balance held by this contract
     * @return The amount of USDC tokens in the contract
     */
    function getUSDCBalance() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /**
     * @dev Returns the USDC allowance a user has granted to this contract
     * @param user The address of the user to check
     * @return The amount of USDC the contract is allowed to spend on behalf of the user
     */
    function getUserUSDCAllowance(address user) public view returns (uint256) {
        return usdc.allowance(user, address(this));
    }

    /**
     * @dev Returns the USDC balance of a user
     * @param user The address of the user to check
     * @return The amount of USDC tokens held by the user
     */
    function getUserUSDCBalance(address user) public view returns (uint256) {
        return usdc.balanceOf(user);
    }

    /**
     * @dev Calculates the amount of AICOIN that can be purchased with a given USDC amount
     * @param usdcAmount The amount of USDC to spend (6 decimals)
     * @return The amount of AICOIN tokens that will be received (18 decimals)
     */
    function calculateAICOINAmount(
        uint256 usdcAmount
    ) public view returns (uint256) {
        return (usdcAmount * 1e18) / price;
    }

    /**
     * @dev Calculates the amount of USDC required to purchase a given AICOIN amount
     * @param aicoinAmount The amount of AICOIN to purchase (18 decimals)
     * @return The amount of USDC required (6 decimals)
     */
    function calculateUSDCAmount(
        uint256 aicoinAmount
    ) public view returns (uint256) {
        return (aicoinAmount * price) / 1e18;
    }

    /**
     * @dev Returns the maximum amount of USDC the contract can accept based on available AICOIN
     * @return The maximum USDC amount that can be used for purchase
     */
    function getMaxAcceptableUSDC() public view returns (uint256) {
        return calculateUSDCAmount(getAICOINBalance());
    }

    /**
     * @dev Checks if a user can successfully complete a purchase
     * @param user The address of the user
     * @param usdcAmount The amount of USDC the user wants to spend
     * @return canPurchase Whether the purchase can be completed
     * @return reason The reason if purchase cannot be completed (empty string if successful)
     * @return aicoinAmount The amount of AICOIN that would be received
     */
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

    /**
     * @dev Internal function to validate if a user can complete a purchase
     * @param user The address of the user
     * @param usdcAmount The amount of USDC to spend
     * @param checkAllowance Whether to check USDC allowance (false when using permit)
     * @return canPurchase Whether the purchase can be completed
     * @return reason The reason if purchase cannot be completed
     * @return aicoinAmount The amount of AICOIN that would be received
     */
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

    /**
     * @dev Internal function to validate and execute a token purchase
     * @param buyer The address of the buyer
     * @param usdcAmount The amount of USDC to spend
     * @param checkAllowance Whether to check USDC allowance (false when using permit)
     */
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

    /**
     * @dev Rejects direct ETH transfers to the contract
     */
    receive() external payable {
        revert("Direct ETH transfers not allowed");
    }

    /**
     * @dev Rejects calls to non-existent functions
     */
    fallback() external payable {
        revert("Fallback not allowed");
    }
}
