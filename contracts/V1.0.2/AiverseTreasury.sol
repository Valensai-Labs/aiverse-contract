// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

interface IAiverseCoinTransferWithSig {
    function transferWithSig(
        address from,
        address to,
        uint256 amount,
        uint256 deadline,
        bytes memory fromSignature
    ) external;
}

/// @title AiverseTreasury V1.0.2 — deposit/claim bound to `paymentId`
/// @notice UUPS proxy; `owner` upgrades. Deposits pull AICOIN with the user's existing token signature
///         (`executor` must be this Treasury proxy). Claims pay out after user + `signer` both sign a digest
///         that includes `paymentId` and the claim product-type constant.
/// @dev `paymentId = keccak256(abi.encode(kind, chainid, this, aicoin, account, amount, deadline, productType))`.
///      `productType` is a contract constant, not a caller argument. Identical inputs cannot be used twice.
///      `usedOperationId` stays in its V1.0.1 slot and is not reused.
contract AiverseTreasuryV1_0_2 is
    Initializable,
    Ownable2StepUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable,
    UUPSUpgradeable
{
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    uint256 public constant SIGNATURE_EXPIRY = 1 hours;

    /// @notice `paymentId` kind discriminator for `deposit` flows
    bytes1 public constant OP_KIND_DEPOSIT = 0x01;
    /// @notice `paymentId` kind discriminator for `claim` flows
    bytes1 public constant OP_KIND_CLAIM = 0x02;

    bytes32 public constant PRODUCT_TYPE_DEPOSIT =
        keccak256("AICOIN_TREASURY_DEPOSIT");
    bytes32 public constant PRODUCT_TYPE_CLAIM =
        keccak256("AICOIN_TREASURY_CLAIM");

    bytes32 private constant _CLAIM_TYPEHASH =
        keccak256(
            "Claim(address token,address recipient,uint256 amount,bytes32 paymentId,bytes32 productType,uint256 nonce,uint256 chainid,uint256 deadline)"
        );

    IERC20 public aicoin;
    address public signer;

    uint256 public minDeposit;
    uint256 public maxDeposit;

    uint256 public minClaim;
    uint256 public maxClaim;

    /// @dev V1.0.1 slot. Retained so the upgrade does not shift `claimNonces` or `isPlatform`.
    mapping(bytes32 => bool) public usedOperationId;
    mapping(address => uint256) public claimNonces;
    mapping(address => bool) public isPlatform;
    /// @dev Appended in V1.0.2. Do not reuse `usedOperationId`.
    mapping(bytes32 => bool) public usedPaymentId;

    event AicoinDeposited(
        bytes32 indexed paymentId,
        address indexed payer,
        uint256 amount,
        uint256 deadline,
        bytes32 productType
    );
    event AicoinClaimed(
        bytes32 indexed paymentId,
        address indexed recipient,
        uint256 amount,
        uint256 deadline,
        bytes32 productType
    );
    event SignerUpdated(
        address indexed previousSigner,
        address indexed newSigner
    );
    event PlatformCallerUpdated(address indexed account, bool allowed);
    event AicoinUpdated(
        address indexed previousAicoin,
        address indexed newAicoin
    );
    event MinDepositUpdated(uint256 previousMin, uint256 newMin);
    event MaxDepositUpdated(uint256 previousMax, uint256 newMax);
    event MinClaimUpdated(uint256 previousMin, uint256 newMin);
    event MaxClaimUpdated(uint256 previousMax, uint256 newMax);

    error NotPlatform();
    error ZeroAddress();
    error InvalidAmount();
    error BelowMinDeposit();
    error AboveMaxDeposit();
    error BelowMinClaim();
    error AboveMaxClaim();
    error DeadlineExpired();
    error DeadlineTooFar();
    error PaymentIdMismatch();
    error PaymentIdAlreadyUsed();
    error InvalidUserSignature();
    error InvalidSignerSignature();
    error InsufficientAicoinBalance();
    error CannotRescueAicoin();
    error InvalidKind();

    struct Payment {
        bytes32 paymentId;
        address account;
        uint256 amount;
        uint256 deadline;
    }

    modifier onlyPlatform() {
        if (!isPlatform[msg.sender]) revert NotPlatform();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param initialOwner Upgrade admin (multisig / timelock)
    /// @param aicoin_ AICOIN proxy; must whitelist this Treasury proxy for `transferWithSig`
    function initialize(
        address initialOwner,
        address aicoin_
    ) public initializer {
        if (initialOwner == address(0)) revert ZeroAddress();
        if (aicoin_ == address(0)) revert ZeroAddress();

        __Ownable_init(initialOwner);
        __Ownable2Step_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __EIP712_init("Aiverse-Treasury", "1");
        __UUPSUpgradeable_init();

        aicoin = IERC20(aicoin_);
        emit AicoinUpdated(address(0), aicoin_);
    }

    function version() external pure returns (string memory) {
        return "1.0.2";
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        address previous = signer;
        signer = newSigner;
        emit SignerUpdated(previous, newSigner);
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

    function setMinClaim(uint256 newMinClaim) external onlyOwner {
        uint256 previous = minClaim;
        minClaim = newMinClaim;
        emit MinClaimUpdated(previous, newMinClaim);
    }

    function setMaxClaim(uint256 newMaxClaim) external onlyOwner {
        uint256 previous = maxClaim;
        maxClaim = newMaxClaim;
        emit MaxClaimUpdated(previous, newMaxClaim);
    }

    /// @notice Recover ERC20 tokens accidentally sent to this contract.
    /// @dev AICOIN is the custodied asset and is intentionally non-rescuable here
    ///      so that owner cannot bypass the dual-signature `claim` flow.
    function rescueERC20(
        address token,
        address to,
        uint256 amount
    ) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (to == address(0)) revert ZeroAddress();
        if (token == address(aicoin)) revert CannotRescueAicoin();
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Payment id for one deposit or claim. Kinds do not overlap.
    /// @param kind `OP_KIND_DEPOSIT` (`account` = payer) or `OP_KIND_CLAIM` (`account` = recipient).
    /// @dev Identical inputs produce the same id and the second call reverts.
    function computePaymentId(
        bytes1 kind,
        address account,
        uint256 amount,
        uint256 deadline
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    kind,
                    block.chainid,
                    address(this),
                    address(aicoin),
                    account,
                    amount,
                    deadline,
                    _productType(kind)
                )
            );
    }

    /// @notice Pull AICOIN from `payer` into this contract via AICOIN `transferWithSig`.
    /// @dev The token signature must use `executor = address(this)`.
    function deposit(
        bytes32 paymentId,
        address payer,
        uint256 amount,
        uint256 deadline,
        bytes calldata fromSignature
    ) external onlyPlatform whenNotPaused nonReentrant {
        Payment memory payment = Payment({
            paymentId: paymentId,
            account: payer,
            amount: amount,
            deadline: deadline
        });
        _deposit(payment, fromSignature);
    }

    function _deposit(
        Payment memory payment,
        bytes calldata fromSignature
    ) internal {
        if (payment.account == address(0)) revert ZeroAddress();
        if (payment.amount == 0) revert InvalidAmount();
        if (payment.amount < minDeposit) revert BelowMinDeposit();
        if (maxDeposit != 0 && payment.amount > maxDeposit) {
            revert AboveMaxDeposit();
        }
        _validateDeadline(payment.deadline);
        _consumePaymentId(OP_KIND_DEPOSIT, payment);

        IAiverseCoinTransferWithSig(address(aicoin)).transferWithSig(
            payment.account,
            address(this),
            payment.amount,
            payment.deadline,
            fromSignature
        );

        emit AicoinDeposited(
            payment.paymentId,
            payment.account,
            payment.amount,
            payment.deadline,
            PRODUCT_TYPE_DEPOSIT
        );
    }

    /// @notice Pay AICOIN from this contract to `recipient` after user + signer EIP-712 signatures.
    /// @dev Both signatures cover the same digest, including `paymentId` and `PRODUCT_TYPE_CLAIM`.
    function claim(
        bytes32 paymentId,
        address recipient,
        uint256 amount,
        uint256 deadline,
        bytes calldata userSig,
        bytes calldata signerSig
    ) external onlyPlatform whenNotPaused nonReentrant {
        Payment memory payment = Payment({
            paymentId: paymentId,
            account: recipient,
            amount: amount,
            deadline: deadline
        });
        _claim(payment, userSig, signerSig);
    }

    function _claim(
        Payment memory payment,
        bytes calldata userSig,
        bytes calldata signerSig
    ) internal {
        if (signer == address(0)) revert ZeroAddress();
        if (payment.account == address(0)) revert ZeroAddress();
        if (payment.amount == 0) revert InvalidAmount();
        if (payment.amount < minClaim) revert BelowMinClaim();
        if (maxClaim != 0 && payment.amount > maxClaim) {
            revert AboveMaxClaim();
        }
        _validateDeadline(payment.deadline);
        _consumePaymentId(OP_KIND_CLAIM, payment);

        bytes32 structHash = keccak256(
            abi.encode(
                _CLAIM_TYPEHASH,
                address(aicoin),
                payment.account,
                payment.amount,
                payment.paymentId,
                PRODUCT_TYPE_CLAIM,
                claimNonces[payment.account],
                block.chainid,
                payment.deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        if (digest.recover(userSig) != payment.account) {
            revert InvalidUserSignature();
        }
        if (digest.recover(signerSig) != signer) {
            revert InvalidSignerSignature();
        }

        claimNonces[payment.account]++;

        if (aicoin.balanceOf(address(this)) < payment.amount) {
            revert InsufficientAicoinBalance();
        }
        aicoin.safeTransfer(payment.account, payment.amount);

        emit AicoinClaimed(
            payment.paymentId,
            payment.account,
            payment.amount,
            payment.deadline,
            PRODUCT_TYPE_CLAIM
        );
    }

    function _productType(bytes1 kind) internal pure returns (bytes32) {
        if (kind == OP_KIND_DEPOSIT) return PRODUCT_TYPE_DEPOSIT;
        if (kind == OP_KIND_CLAIM) return PRODUCT_TYPE_CLAIM;
        revert InvalidKind();
    }

    function _consumePaymentId(bytes1 kind, Payment memory payment) internal {
        if (
            payment.paymentId !=
            computePaymentId(
                kind,
                payment.account,
                payment.amount,
                payment.deadline
            )
        ) revert PaymentIdMismatch();
        if (usedPaymentId[payment.paymentId]) revert PaymentIdAlreadyUsed();
        usedPaymentId[payment.paymentId] = true;
    }

    function _validateDeadline(uint256 deadline) internal view {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (deadline > block.timestamp + SIGNATURE_EXPIRY) {
            revert DeadlineTooFar();
        }
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
