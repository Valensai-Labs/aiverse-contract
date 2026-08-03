// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

interface IPowerAsset {
    function mintActivityRewards(
        address user,
        address relayerNode,
        uint256 amount
    ) external;
}

interface INodeManager {
    function owner() external view returns (address);

    function isNode(address addr) external view returns (bool);

    function getNodeList() external view returns (address[] memory);

    function isValidNodeSigner(
        address beneficiary,
        address signer
    ) external view returns (bool);
}

/// @title ActivityManager — claim campaign/activity AIHASH to wallet
/// @dev Parallel to CheckInManager weekly claim, but nonce-based (no week lock) with minClaim.
///      Does not require on-chain emailHash registration.
contract ActivityManager is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    EIP712Upgradeable,
    ReentrancyGuardUpgradeable
{
    using ECDSA for bytes32;

    INodeManager public nodeManager;
    IPowerAsset public powerAsset;

    uint256 public constant SIGNATURE_EXPIRY = 2 minutes;

    address public foundationSigner;
    /// @notice Minimum claimable amount (18 decimals). Default 60 AIHASH.
    uint256 public minClaim;
    /// @notice Maximum claimable amount per tx (18 decimals). Must be set before claims.
    uint256 public maxMint;

    bytes32 private constant _ACTIVITY_CLAIM_TYPEHASH =
        keccak256(
            "ActivityClaim(address userAddr,uint256 amount,uint256 nonce,uint256 chainid,uint256 expireAt)"
        );

    mapping(address => uint256) public nonces;

    event ActivityClaimed(
        address indexed userAddr,
        address indexed relayerNode,
        uint256 amount,
        uint256 nonce
    );
    event MinClaimUpdated(uint256 previousMin, uint256 newMin);
    event MaxMintUpdated(uint256 previousMax, uint256 newMax);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _nodeManagerAddr,
        address _powerAssetAddr
    ) public virtual initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __EIP712_init("Aiverse-Activity-Manager", "1");
        __ReentrancyGuard_init();

        nodeManager = INodeManager(_nodeManagerAddr);
        powerAsset = IPowerAsset(_powerAssetAddr);
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

    function setFoundationSigner(
        address _foundationSigner
    ) external onlyOwner whenNotPaused {
        require(_foundationSigner != address(0), "Invalid foundation signer");
        foundationSigner = _foundationSigner;
    }

    function setMinClaim(uint256 newMinClaim) external onlyOwner whenNotPaused {
        require(newMinClaim > 0, "Invalid min claim");
        require(newMinClaim < maxMint, "Min claim must be below max mint");
        uint256 previous = minClaim;
        minClaim = newMinClaim;
        emit MinClaimUpdated(previous, newMinClaim);
    }

    function setMaxMint(uint256 newMaxMint) external onlyOwner whenNotPaused {
        require(newMaxMint > minClaim, "Max mint must exceed min claim");
        uint256 previous = maxMint;
        maxMint = newMaxMint;
        emit MaxMintUpdated(previous, newMaxMint);
    }

    function setPowerAsset(
        address _powerAssetAddr
    ) external onlyOwner whenNotPaused {
        require(_powerAssetAddr != address(0), "Invalid power asset");
        powerAsset = IPowerAsset(_powerAssetAddr);
    }

    /// @notice Claim activity AIHASH to user wallet (amount must be in [minClaim, maxMint]).
    function claimActivity(
        address userAddr,
        address relayerNode,
        uint256 amount,
        uint256 expireAt,
        bytes memory userSig,
        bytes memory foundationSig
    ) external nonReentrant whenNotPaused {
        require(userAddr != address(0), "Invalid user address");
        require(relayerNode != address(0), "Invalid relayer node address");
        require(amount >= minClaim, "Below min claim");
        require(maxMint > 0 && amount <= maxMint, "Above max mint");

        require(
            nodeManager.isValidNodeSigner(relayerNode, msg.sender),
            "Invalid Node Or Signer"
        );

        require(block.timestamp <= expireAt, "Signature expired");
        require(
            expireAt <= block.timestamp + SIGNATURE_EXPIRY,
            "Expiry too far in future"
        );

        uint256 userNonce = nonces[userAddr];

        bytes32 structHash = keccak256(
            abi.encode(
                _ACTIVITY_CLAIM_TYPEHASH,
                userAddr,
                amount,
                userNonce,
                block.chainid,
                expireAt
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        address recoveredUser = digest.recover(userSig);
        require(recoveredUser == userAddr, "Invalid user signature");
        address recoveredFoundation = digest.recover(foundationSig);
        require(
            recoveredFoundation == foundationSigner,
            "Invalid foundation signature"
        );

        nonces[userAddr] = userNonce + 1;

        powerAsset.mintActivityRewards(userAddr, relayerNode, amount);

        emit ActivityClaimed(userAddr, relayerNode, amount, userNonce);
    }

    function getNonce(address userAddr) external view returns (uint256) {
        return nonces[userAddr];
    }
}
