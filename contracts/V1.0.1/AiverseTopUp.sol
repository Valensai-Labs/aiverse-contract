// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

interface IPowerAssetPassBonus {
    function mintPassBonus(address userAddr, uint256 amount) external;
}

/// @title AiverseTopUp — Agent credit USDC top-up (platform relay + EIP-2612)
/// @notice UUPS upgradeable implementation: logic contract sits behind an `ERC1967Proxy`; upgrades are performed by `owner` via `upgradeToAndCall`.
///         Ownership uses two-step transfer (`Ownable2StepUpgradeable`): `transferOwnership` only sets a pending owner; the new owner must call `acceptOwnership` to complete the handover.
///         USDC is stored as `IERC20` and set at deploy/init; amounts are raw `uint256` (USDC commonly uses 6 decimals).
///         Permit EIP-712 must align with the proxy address, `DOMAIN_SEPARATOR`, and `nonces(owner)`.
/// @dev **Call model:** only `platform` allowlisted addresses may call `depositWithPermit` / `depositWithPermitAndGrant`; user EOAs do not call this contract directly,
///      they only sign `permit(owner, address(this), amount, deadline, v, r, s)` off-chain (`address(this)` is the proxy).
///      Per-transaction flow: after checks, set `usedPaymentId[paymentId] = true` (CEI), then optionally call `permit` depending on `allowance` (`try`/`catch` tolerates a frontrunner that already consumed the signature), then `safeTransferFrom`;
///      if allowance is still insufficient, `safeTransferFrom` reverts, the whole transaction rolls back, and the mapping is not left incorrectly set to true.
/// @dev **`paymentId` binding (depositWithPermit):** 
///      `keccak256(abi.encode(block.chainid, address(this), address(usdc), owner, amount, deadline, productType))`.
/// @dev **`paymentId` binding (depositWithPermitAndGrant):** same tuple plus trailing `giftAmount`
///      (AIHASH raw, 18 decimals). Off-chain must precompute with the matching helper.
/// @dev **Upgrade (from V1.0.0):** storage only appends `powerAsset` + `maxGiftAmount`. Do not re-call `initialize`;
///      after `upgradeTo`, owner calls `setPowerAsset` (and optionally `setMaxGiftAmount`).
///
/// **Explicit revert reasons in this contract:**
/// - `NotPlatform()` — `msg.sender` is not on the platform allowlist
/// - `ZeroAddress()` — zero address argument
/// - `ZeroTreasury()` — `treasury` is not configured
/// - `InvalidAmount()` — `amount == 0`
/// - `BelowMinDeposit()` / `AboveMaxDeposit()` — amount bounds
/// - `AboveMaxGift()` — `giftAmount` above `maxGiftAmount` when cap is set
/// - `PowerAssetNotSet()` — grant path with `giftAmount > 0` but `powerAsset` unset
/// - `PaymentIdMismatch()` — `paymentId` does not match bound fields
/// - `PaymentIdAlreadyUsed()` — `paymentId` already consumed
/// - `PermitExpired()` — `deadline` has passed
/// - `StuckUsdcInContract()` — this contract still holds a balance of the previous `usdc` when `setUsdc` is called

contract AiverseTopUpV1_0_1 is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // --- storage layout (V1.0.0) — do not reorder / insert above append section ---
    IERC20 public usdc;

    address public treasury;

    uint256 public minDeposit;
    uint256 public maxDeposit;

    mapping(address => bool) public isPlatform;

    /// @notice `paymentId` logically reserved (set before external calls; reverts in the same tx roll this back)
    mapping(bytes32 => bool) public usedPaymentId;

    // --- appended in V1.0.1 (upgrade-safe) ---
    IPowerAssetPassBonus public powerAsset;

    /// @notice Optional cap on `giftAmount` (18 decimals).
    ///         Must be set (`> 0`) before any grant with `giftAmount > 0`.
    uint256 public maxGiftAmount;

    event UsdcDepositSettled(
        bytes32 indexed paymentId,
        address indexed owner,
        address indexed treasury,
        address token,
        uint256 amount,
        uint256 deadline,
        uint256 productType
    );

    event PassBonusGranted(
        bytes32 indexed paymentId,
        address indexed owner,
        uint256 giftAmount
    );

    event TreasuryUpdated(
        address indexed previousTreasury,
        address indexed newTreasury
    );
    event PlatformCallerUpdated(address indexed account, bool allowed);
    event MinDepositUpdated(uint256 previousMin, uint256 newMin);
    event MaxDepositUpdated(uint256 previousMax, uint256 newMax);
    event UsdcUpdated(address indexed previousUsdc, address indexed newUsdc);
    event PowerAssetUpdated(
        address indexed previousPowerAsset,
        address indexed newPowerAsset
    );
    event MaxGiftAmountUpdated(uint256 previousMax, uint256 newMax);

    error NotPlatform();
    error ZeroAddress();
    error ZeroTreasury();
    error InvalidAmount();
    error BelowMinDeposit();
    error AboveMaxDeposit();
    error AboveMaxGift();
    error PermitExpired();
    error PaymentIdMismatch();
    error PaymentIdAlreadyUsed();
    error StuckUsdcInContract();
    error PowerAssetNotSet();

    modifier onlyPlatform() {
        if (!isPlatform[msg.sender]) revert NotPlatform();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param initialOwner Owner set when initializing the proxy after deployment; may be a multisig or Timelock
    /// @param usdc_ USDC token contract address
    /// @param treasury_ Platform payout recipient
    /// @param initialPlatform First address allowed to call `depositWithPermit`
    /// @dev Existing proxies upgrading to this implementation must NOT call `initialize` again.
    function initialize(
        address initialOwner,
        address usdc_,
        address treasury_,
        address initialPlatform
    ) public initializer {
        if (initialOwner == address(0)) revert ZeroAddress();
        if (usdc_ == address(0)) revert ZeroAddress();
        if (treasury_ == address(0)) revert ZeroAddress();
        if (initialPlatform == address(0)) revert ZeroAddress();

        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        usdc = IERC20(usdc_);
        treasury = treasury_;
        isPlatform[initialPlatform] = true;

        emit TreasuryUpdated(address(0), treasury_);
        emit PlatformCallerUpdated(initialPlatform, true);
        emit UsdcUpdated(address(0), usdc_);
    }

    function version() external pure returns (string memory) {
        return "1.0.1";
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Replace the USDC address (e.g. wrong testnet vs mainnet configuration); requires this contract's balance of the current `usdc` to be zero to avoid stranded funds.
    ///         `computePaymentId` includes `address(usdc)`; off-chain systems must recompute `paymentId` using the new token address after a switch.
    function setUsdc(address newUsdc) external onlyOwner {
        if (newUsdc == address(0)) revert ZeroAddress();
        address previous = address(usdc);
        if (
            previous != address(0) &&
            IERC20(previous).balanceOf(address(this)) != 0
        ) {
            revert StuckUsdcInContract();
        }
        usdc = IERC20(newUsdc);
        emit UsdcUpdated(previous, newUsdc);
    }

    /// @notice Recover ERC20 tokens mistakenly sent to this contract; clears balances so `setUsdc` and similar operations can proceed
    /// @param token Token contract address (may be the current `usdc` to clear `StuckUsdcInContract` when `setUsdc` would otherwise be blocked)
    function rescueERC20(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address previous = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(previous, newTreasury);
    }

    function setPlatform(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        isPlatform[account] = allowed;
        emit PlatformCallerUpdated(account, allowed);
    }

    function setMinDeposit(uint256 newMinDeposit) external onlyOwner {
        uint256 previous = minDeposit;
        minDeposit = newMinDeposit;
        emit MinDepositUpdated(previous, newMinDeposit);
    }

    function setMaxDeposit(uint256 newMaxDeposit) external onlyOwner {
        uint256 previous = maxDeposit;
        maxDeposit = newMaxDeposit;
        emit MaxDepositUpdated(previous, newMaxDeposit);
    }

    /// @notice Bind PowerAsset proxy after upgrade (not part of `initialize`).
    function setPowerAsset(address newPowerAsset) external onlyOwner {
        if (newPowerAsset == address(0)) revert ZeroAddress();
        address previous = address(powerAsset);
        powerAsset = IPowerAssetPassBonus(newPowerAsset);
        emit PowerAssetUpdated(previous, newPowerAsset);
    }

    /// @notice Cap for `giftAmount` in `depositWithPermitAndGrant`.
    ///         When `giftAmount > 0`, this must be set (`> 0`) and `giftAmount` must not exceed it.
    function setMaxGiftAmount(uint256 newMaxGiftAmount) external onlyOwner {
        uint256 previous = maxGiftAmount;
        maxGiftAmount = newMaxGiftAmount;
        emit MaxGiftAmountUpdated(previous, newMaxGiftAmount);
    }

    /// @notice Computes `paymentId` the same way as `depositWithPermit` for off-chain preparation and reconciliation
    /// @dev `keccak256(abi.encode(block.chainid, address(this), address(usdc), owner, amount, deadline, productType))`
    /// @param productType Application-defined product discriminator bound into `paymentId`
    function computePaymentId(
        address owner,
        uint256 amount,
        uint256 deadline,
        uint256 productType
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    block.chainid,
                    address(this),
                    address(usdc),
                    owner,
                    amount,
                    deadline,
                    productType
                )
            );
    }

    /// @notice Grant-path encoding: includes `giftAmount` (18 decimals AIHASH raw)
    function computePaymentIdWithGrant(
        address owner,
        uint256 amount,
        uint256 deadline,
        uint256 productType,
        uint256 giftAmount
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    block.chainid,
                    address(this),
                    address(usdc),
                    owner,
                    amount,
                    deadline,
                    productType,
                    giftAmount
                )
            );
    }

    /// @notice Platform-relayed deposit: optionally raises allowance via `permit`, then `transferFrom` to `treasury`
    /// @param productType Application-defined product discriminator; must be included in off-chain `paymentId` and here identically
    function depositWithPermit(
        bytes32 paymentId,
        address owner,
        uint256 amount,
        uint256 deadline,
        uint256 productType,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyPlatform whenNotPaused nonReentrant {
        _validateDepositCommon(owner, amount, deadline);

        if (paymentId != computePaymentId(owner, amount, deadline, productType))
            revert PaymentIdMismatch();
        if (usedPaymentId[paymentId]) revert PaymentIdAlreadyUsed();

        usedPaymentId[paymentId] = true;

        IERC20 usdc_ = _pullUsdcWithPermit(owner, amount, deadline, v, r, s);

        emit UsdcDepositSettled(
            paymentId,
            owner,
            treasury,
            address(usdc_),
            amount,
            deadline,
            productType
        );
    }

    /// @notice Deposit + mint `giftAmount` AIHASH to `owner` via PowerAsset in the same tx (atomic).
    /// @param giftAmount Raw AIHASH (18 decimals). Bound into `paymentId`. `0` skips mint.
    function depositWithPermitAndGrant(
        bytes32 paymentId,
        address owner,
        uint256 amount,
        uint256 deadline,
        uint256 productType,
        uint256 giftAmount,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyPlatform whenNotPaused nonReentrant {
        _validateDepositCommon(owner, amount, deadline);

        if (giftAmount > 0) {
            if (maxGiftAmount == 0 || giftAmount > maxGiftAmount)
                revert AboveMaxGift();
        }
        if (
            paymentId !=
            computePaymentIdWithGrant(
                owner,
                amount,
                deadline,
                productType,
                giftAmount
            )
        ) revert PaymentIdMismatch();
        if (usedPaymentId[paymentId]) revert PaymentIdAlreadyUsed();

        if (giftAmount > 0 && address(powerAsset) == address(0))
            revert PowerAssetNotSet();

        usedPaymentId[paymentId] = true;

        IERC20 usdc_ = _pullUsdcWithPermit(owner, amount, deadline, v, r, s);

        if (giftAmount > 0) {
            powerAsset.mintPassBonus(owner, giftAmount);
        }

        emit UsdcDepositSettled(
            paymentId,
            owner,
            treasury,
            address(usdc_),
            amount,
            deadline,
            productType
        );

        if (giftAmount > 0) {
            emit PassBonusGranted(paymentId, owner, giftAmount);
        }
    }

    function _validateDepositCommon(
        address owner,
        uint256 amount,
        uint256 deadline
    ) internal view {
        if (owner == address(0)) revert ZeroAddress();
        if (treasury == address(0)) revert ZeroTreasury();
        if (amount == 0) revert InvalidAmount();
        if (amount < minDeposit) revert BelowMinDeposit();
        if (maxDeposit != 0 && amount > maxDeposit) revert AboveMaxDeposit();
        if (deadline < block.timestamp) revert PermitExpired();
    }

    function _pullUsdcWithPermit(
        address owner,
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal returns (IERC20 usdc_) {
        usdc_ = usdc;
        if (usdc_.allowance(owner, address(this)) < amount) {
            try
                IERC20Permit(address(usdc_)).permit(
                    owner,
                    address(this),
                    amount,
                    deadline,
                    v,
                    r,
                    s
                )
            {} catch {}
        }
        usdc_.safeTransferFrom(owner, treasury, amount);
    }

    function _authorizeUpgrade(
        address newImplementation
    ) internal override onlyOwner {}

    receive() external payable {
        revert("Direct ETH transfers not allowed");
    }

    fallback() external payable {
        revert("Fallback not allowed");
    }
}
