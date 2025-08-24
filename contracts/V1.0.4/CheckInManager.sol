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
        address checkInNode,
        address verifierNode
    ) external;
}

interface INodeManager {
    function owner() external view returns (address);

    function isNode(address addr) external view returns (bool);

    function getNodeList() external view returns (address[] memory);
}

contract CheckInManagerV1_0_4 is
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

    uint256 public constant SIGNATURE_EXPIRY = 1 hours;
    bytes32 private constant _CHECKIN_TYPEHASH =
        keccak256(
            "CheckIn(address userAddr,address checkInNode,uint256 nonce,uint256 chainid,uint256 expireAt)"
        );

    mapping(address => uint256) public nonces;
    mapping(address => mapping(uint256 => bool)) public checkedIn;
    mapping(address => mapping(uint256 => address)) public verifierNodeForDay;

    event VerifierNodeSelected(
        address indexed userAddr,
        address indexed verifierNode,
        uint256 indexed day
    );
    event CheckedIn(
        address indexed userAddr,
        address indexed checkInNode,
        address indexed verifierNode,
        uint256 day
    );

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
        return "1.0.4";
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function selectRandomVerifierNode(
        address userAddr
    ) external nonReentrant whenNotPaused returns (address) {
        require(userAddr != address(0), "Invalid user address");

        _checkIsNode(msg.sender);
        address[] memory nodeListArray = nodeManager.getNodeList();
        require(nodeListArray.length > 1, "Not enough nodes");

        uint256 today = _getToday();
        require(
            verifierNodeForDay[userAddr][today] == address(0),
            "Already selected today"
        );

        uint256 randomSeed = uint256(
            keccak256(
                abi.encodePacked(
                    blockhash(block.number - 1) != bytes32(0)
                        ? blockhash(block.number - 1)
                        : blockhash(block.number - 2),
                    block.prevrandao,
                    block.timestamp,
                    userAddr,
                    nonces[userAddr]
                )
            )
        );

        uint256 startIndex = randomSeed % nodeListArray.length;

        address verifierNode;
        for (uint256 i = 0; i < nodeListArray.length; i++) {
            uint256 idx = (startIndex + i) % nodeListArray.length;
            if (nodeListArray[idx] != msg.sender) {
                verifierNode = nodeListArray[idx];
                break;
            }
        }

        verifierNodeForDay[userAddr][today] = verifierNode;
        emit VerifierNodeSelected(userAddr, verifierNode, today);
        return verifierNode;
    }

    function checkIn(
        address userAddr,
        address checkInNode,
        uint256 expireAt,
        bytes memory userSig,
        bytes memory checkInNodeSig
    ) external nonReentrant whenNotPaused {
        require(userAddr != address(0), "Invalid user address");

        _checkIsNode(msg.sender);
        _checkIsNode(checkInNode);
        require(block.timestamp <= expireAt, "Signature expired");
        require(
            expireAt <= block.timestamp + SIGNATURE_EXPIRY,
            "Expiry too far in future"
        );

        uint256 today = _getToday();
        require(
            accountRegistrar.userEmailHash(userAddr) != bytes32(0),
            "User not registered"
        );
        require(!checkedIn[userAddr][today], "Already checked today");

        address verifierNode = verifierNodeForDay[userAddr][today];
        require(verifierNode == msg.sender, "Non-designated verifier node");

        bytes32 structHash = keccak256(
            abi.encode(
                _CHECKIN_TYPEHASH,
                userAddr,
                checkInNode,
                nonces[userAddr],
                block.chainid,
                expireAt
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        address recoveredUser = digest.recover(userSig);
        require(recoveredUser == userAddr, "Invalid user signature");

        address recoveredCheckInNode = digest.recover(checkInNodeSig);
        require(
            recoveredCheckInNode == checkInNode,
            "Invalid checkIn node signature"
        );

        checkedIn[userAddr][today] = true;
        nonces[userAddr]++;
        powerAsset.mintCheckInRewards(userAddr, checkInNode, msg.sender);

        emit CheckedIn(userAddr, checkInNode, msg.sender, today);
    }

    function hasCheckedInToday(address userAddr) external view returns (bool) {
        return checkedIn[userAddr][_getToday()];
    }

    function getNonce(address userAddr) external view returns (uint256) {
        return nonces[userAddr];
    }

    function getVerifierNodeForToday(
        address userAddr
    ) external view returns (address) {
        return verifierNodeForDay[userAddr][_getToday()];
    }

    function _checkIsNode(address addr) internal view {
        require(nodeManager.isNode(addr), "Invalid Node");
    }

    function _getToday() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }
}
