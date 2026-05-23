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

/// @title AiverseTreasury — AICOIN custody: deposit via token `transferWithSig`, claim via dual EIP-712
/// @notice UUPS proxy; `owner` upgrades. Deposits pull AICOIN into this contract using the user's AICOIN EIP-712 signature
///         (`executor` in that signature must be `address(this)`, the Treasury proxy). Claims pay out from this balance
///         after user + `signer` both sign the Treasury EIP-712 claim digest. Only `signer` may call `deposit` / `claim`.
/// @dev `operationId` is namespaced by a `kind` byte to keep deposit and claim ID spaces disjoint:
///      `keccak256(abi.encode(kind, chainid, this, aicoin, account, amount, deadline))`
///      where `kind = OP_KIND_DEPOSIT (0x01)` for `deposit` and `OP_KIND_CLAIM (0x02)` for `claim`.
///      `aicoin` is set once at `initialize` and is not mutable thereafter.
///      AICOIN must whitelist this proxy (`setWhitelistAddr`) so `transferWithSig` succeeds when called from here.
contract AiverseTreasury is
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

    /// @notice `operationId` kind discriminator for `deposit` flows
    bytes1 public constant OP_KIND_DEPOSIT = 0x01;
    /// @notice `operationId` kind discriminator for `claim` flows
    bytes1 public constant OP_KIND_CLAIM = 0x02;

    bytes32 private constant _CLAIM_TYPEHASH =
        keccak256(
            "Claim(address token,address recipient,uint256 amount,bytes32 operationId,uint256 nonce,uint256 chainid,uint256 deadline)"
        );

    IERC20 public aicoin;
    address public signer;

    uint256 public minDeposit;
    uint256 public maxDeposit;

    uint256 public minClaim;
    uint256 public maxClaim;

    mapping(bytes32 => bool) public usedOperationId;
    mapping(address => uint256) public claimNonces;

    event AicoinDeposited(
        bytes32 indexed operationId,
        address indexed payer,
        uint256 amount,
        uint256 deadline
    );
    event AicoinClaimed(
        bytes32 indexed operationId,
        address indexed recipient,
        uint256 amount,
        uint256 deadline
    );
    event SignerUpdated(
        address indexed previousSigner,
        address indexed newSigner
    );
    event AicoinUpdated(
        address indexed previousAicoin,
        address indexed newAicoin
    );
    event MinDepositUpdated(uint256 previousMin, uint256 newMin);
    event MaxDepositUpdated(uint256 previousMax, uint256 newMax);
    event MinClaimUpdated(uint256 previousMin, uint256 newMin);
    event MaxClaimUpdated(uint256 previousMax, uint256 newMax);

    error NotSigner();
    error ZeroAddress();
    error InvalidAmount();
    error BelowMinDeposit();
    error AboveMaxDeposit();
    error BelowMinClaim();
    error AboveMaxClaim();
    error DeadlineExpired();
    error DeadlineTooFar();
    error OperationIdMismatch();
    error OperationIdAlreadyUsed();
    error InvalidUserSignature();
    error InvalidSignerSignature();
    error InsufficientAicoinBalance();
    error CannotRescueAicoin();

    modifier onlySigner() {
        if (msg.sender != signer) revert NotSigner();
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param initialOwner Upgrade admin (multisig / timelock)
    /// @param aicoin_ AICOIN proxy; must whitelist this Treasury proxy for `transferWithSig`
    /// @dev `signer` is not set here; owner must call `setSigner` before `deposit` / `claim` are usable.
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
        return "1.0.0";
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

    /// @notice Operation id namespaced by `kind` so deposit / claim ID spaces are disjoint.
    /// @param kind `OP_KIND_DEPOSIT` (`account` = payer) or `OP_KIND_CLAIM` (`account` = recipient).
    function computeOperationId(
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
                    deadline
                )
            );
    }

    /// @notice Pull AICOIN from `payer` into this contract via AICOIN `transferWithSig`
    /// @dev User's AICOIN signature must use `executor = address(this)` (Treasury proxy). Caller must be `signer`.
    function deposit(
        bytes32 operationId,
        address payer,
        uint256 amount,
        uint256 deadline,
        bytes calldata fromSignature
    ) external onlySigner whenNotPaused nonReentrant {
        if (payer == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (amount < minDeposit) revert BelowMinDeposit();
        if (maxDeposit != 0 && amount > maxDeposit) revert AboveMaxDeposit();
        _validateDeadline(deadline);

        if (
            operationId !=
            computeOperationId(OP_KIND_DEPOSIT, payer, amount, deadline)
        ) revert OperationIdMismatch();
        if (usedOperationId[operationId]) revert OperationIdAlreadyUsed();

        usedOperationId[operationId] = true;

        IAiverseCoinTransferWithSig(address(aicoin)).transferWithSig(
            payer,
            address(this),
            amount,
            deadline,
            fromSignature
        );

        emit AicoinDeposited(operationId, payer, amount, deadline);
    }

    /// @notice Pay AICOIN from this contract to `recipient` after user + signer EIP-712 signatures
    /// @dev Same digest for `userSig` and `signerSig` (CheckIn-style). Caller must be `signer`.
    function claim(
        bytes32 operationId,
        address recipient,
        uint256 amount,
        uint256 deadline,
        bytes calldata userSig,
        bytes calldata signerSig
    ) external onlySigner whenNotPaused nonReentrant {
        if (recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert InvalidAmount();
        if (amount < minClaim) revert BelowMinClaim();
        if (maxClaim != 0 && amount > maxClaim) {
            revert AboveMaxClaim();
        }
        _validateDeadline(deadline);

        if (
            operationId !=
            computeOperationId(OP_KIND_CLAIM, recipient, amount, deadline)
        ) revert OperationIdMismatch();
        if (usedOperationId[operationId]) revert OperationIdAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(
                _CLAIM_TYPEHASH,
                address(aicoin),
                recipient,
                amount,
                operationId,
                claimNonces[recipient],
                block.chainid,
                deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        if (digest.recover(userSig) != recipient) {
            revert InvalidUserSignature();
        }
        if (digest.recover(signerSig) != signer) {
            revert InvalidSignerSignature();
        }

        usedOperationId[operationId] = true;
        claimNonces[recipient]++;

        if (aicoin.balanceOf(address(this)) < amount) {
            revert InsufficientAicoinBalance();
        }
        aicoin.safeTransfer(recipient, amount);

        emit AicoinClaimed(operationId, recipient, amount, deadline);
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
