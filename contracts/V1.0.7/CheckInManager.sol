// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

interface IAccountRegistrar {
    function userEmailHash(address user) external view returns (bytes32);
}

interface IPowerAsset {
    function mintCheckInRewards(
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

contract CheckInManagerV1_0_7 is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    EIP712Upgradeable,
    ReentrancyGuardUpgradeable
{
    using ECDSA for bytes32;

    INodeManager public nodeManager;
    IAccountRegistrar public accountRegistrar;
    IPowerAsset public powerAsset;

    uint256 public constant SIGNATURE_EXPIRY = 24 hours;

    address public foundationSigner;

    bytes32 private constant _WEEKLY_CHECKIN_TYPEHASH =
        keccak256(
            "WeeklyCheckIn(address userAddr,uint256 amount,uint256 week,uint256 nonce,uint256 chainid,uint256 expireAt)"
        );

    mapping(address => uint256) public nonces;
    mapping(address => mapping(uint256 => bool)) public weeklyCheckedIn;

    event WeeklyCheckedIn(
        address indexed userAddr,
        address indexed relayerNode,
        uint256 indexed week,
        uint256 amount
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address _nodeManagerAddr,
        address _registrarAddr,
        address _powerAssetAddr
    ) public virtual initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __EIP712_init("Aiverse-CheckIn-Manager", "1");
        __ReentrancyGuard_init();

        nodeManager = INodeManager(_nodeManagerAddr);
        accountRegistrar = IAccountRegistrar(_registrarAddr);
        powerAsset = IPowerAsset(_powerAssetAddr);
    }

    function version() public pure returns (string memory) {
        return "1.0.7";
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

    function checkInWeekly(
        address userAddr,
        address relayerNode,
        uint256 amount,
        uint256 week,
        uint256 expireAt,
        bytes memory userSig,
        bytes memory foundationSig
    ) external nonReentrant whenNotPaused {
        // Verify that msg.sender is a valid signer for relayerNode
        require(
            nodeManager.isValidNodeSigner(relayerNode, msg.sender),
            "Invalid Node Or Signer"
        );
        _requireWeeklyCheckIn(userAddr, amount, week, expireAt, true);
        _settleWeeklyCheckIn(
            userAddr,
            relayerNode,
            amount,
            week,
            expireAt,
            userSig,
            foundationSig,
            true
        );
    }

    /// @notice Self-paid weekly claim. `userAddr` is `msg.sender`; no userSig or email registration.
    function checkInWeeklySelf(
        address relayerNode,
        uint256 amount,
        uint256 week,
        uint256 expireAt,
        bytes calldata foundationSig
    ) external nonReentrant whenNotPaused {
        require(nodeManager.isNode(relayerNode), "Invalid relayer node");
        address userAddr = msg.sender;
        _requireWeeklyCheckIn(userAddr, amount, week, expireAt, false);
        _settleWeeklyCheckIn(
            userAddr,
            relayerNode,
            amount,
            week,
            expireAt,
            bytes(""),
            foundationSig,
            false
        );
    }

    function hasCheckedInThisWeek(
        address userAddr
    ) external view returns (bool) {
        return weeklyCheckedIn[userAddr][_getCurrentWeek()];
    }

    function hasCheckedInForWeek(
        address userAddr,
        uint256 week
    ) external view returns (bool) {
        return weeklyCheckedIn[userAddr][week];
    }

    function getNonce(address userAddr) external view returns (uint256) {
        return nonces[userAddr];
    }

    function getCurrentWeek() external view returns (uint256) {
        return _getCurrentWeek();
    }

    function _requireWeeklyCheckIn(
        address userAddr,
        uint256 amount,
        uint256 week,
        uint256 expireAt,
        bool requireRegistered
    ) internal view {
        require(userAddr != address(0), "Invalid user address");
        require(amount > 0, "Invalid amount");
        require(block.timestamp <= expireAt, "Signature expired");
        require(
            expireAt <= block.timestamp + SIGNATURE_EXPIRY,
            "Expiry too far in future"
        );

        uint256 currentWeek = _getCurrentWeek();
        require(
            (week == currentWeek) || (week == currentWeek - 1),
            "Invalid week"
        );
        require(
            !weeklyCheckedIn[userAddr][week],
            "Already checked-in this week"
        );
        if (requireRegistered) {
            require(
                accountRegistrar.userEmailHash(userAddr) != bytes32(0),
                "User not registered"
            );
        }
    }

    function _settleWeeklyCheckIn(
        address userAddr,
        address relayerNode,
        uint256 amount,
        uint256 week,
        uint256 expireAt,
        bytes memory userSig,
        bytes memory foundationSig,
        bool verifyUserSig
    ) internal {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _WEEKLY_CHECKIN_TYPEHASH,
                    userAddr,
                    amount,
                    week,
                    nonces[userAddr],
                    block.chainid,
                    expireAt
                )
            )
        );
        if (verifyUserSig) {
            require(
                digest.recover(userSig) == userAddr,
                "Invalid user signature"
            );
        }
        require(
            digest.recover(foundationSig) == foundationSigner,
            "Invalid foundation signature"
        );

        weeklyCheckedIn[userAddr][week] = true;
        nonces[userAddr]++;
        powerAsset.mintCheckInRewards(userAddr, relayerNode, amount);
        emit WeeklyCheckedIn(userAddr, relayerNode, week, amount);
    }

    function _getCurrentWeek() internal view returns (uint256) {
        return (block.timestamp - 1759708800) / (7 days);
    }
}
