// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract FirstFunding is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20Upgradeable for IERC20Upgradeable;

    IERC20Upgradeable public usdc;
    IERC20Upgradeable public usdt;
    IERC20Upgradeable public aicoin;

    uint256 public constant SALE_AMOUNT = 15_000 * 10 ** 6;
    uint256 public constant TOKEN_AMOUNT = 100_000_000 * 10 ** 18;

    event Bought(
        address indexed buyer,
        address indexed paymentToken,
        uint256 paymentAmount,
        uint256 tokenAmount
    );
    event Withdraw(address indexed to, address indexed token, uint256 amount);

    function initialize(
        address _usdc,
        address _usdt,
        address _aicoin,
        address owner_
    ) external initializer {
        require(
            _usdc != address(0) && _usdt != address(0) && _aicoin != address(0),
            "Zero address"
        );
        __Ownable_init(msg.sender);
        __ReentrancyGuard_init();

        usdc = IERC20Upgradeable(_usdc);
        usdt = IERC20Upgradeable(_usdt);
        aicoin = IERC20Upgradeable(_aicoin);

        _transferOwnership(owner_);
    }

    function buyWithUSDC(uint256 quantity) external nonReentrant {
        _buy(usdc, quantity);
    }

    function buyWithUSDT(uint256 quantity) external nonReentrant {
        _buy(usdt, quantity);
    }

    function _buy(IERC20Upgradeable paymentToken, uint256 quantity) internal {
        require(quantity > 0, "Quantity must be > 0");

        uint256 totalPayment = SALE_AMOUNT * quantity;
        uint256 totalToken = TOKEN_AMOUNT * quantity;

        require(
            aicoin.balanceOf(address(this)) >= totalToken,
            "Insufficient token balance"
        );
        require(
            paymentToken.allowance(msg.sender, address(this)) >= totalPayment,
            "Approve payment token first"
        );

        paymentToken.safeTransferFrom(msg.sender, address(this), totalPayment);
        aicoin.safeTransfer(msg.sender, totalToken);

        emit Bought(
            msg.sender,
            address(paymentToken),
            totalPayment,
            totalToken
        );
    }

    function withdraw(
        address to,
        uint256 amount,
        address paymentToken
    ) external onlyOwner {
        require(to != address(0), "Zero address");
        require(
            paymentToken == address(usdc) ||
                paymentToken == address(usdt) ||
                paymentToken == address(aicoin),
            "Unsupported token"
        );
        IERC20Upgradeable tokenToWithdraw = IERC20Upgradeable(paymentToken);
        tokenToWithdraw.safeTransfer(to, amount);
        emit Withdraw(to, paymentToken, amount);
    }
}
