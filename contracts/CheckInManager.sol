// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

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
    function nodeList() external view returns (address[] memory);
}

contract CheckInManager is Ownable, EIP712, ReentrancyGuard {
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

    constructor(
        address _nodeManagerAddr,
        address _registrarAddr,
        address _powerAssetAddr
    ) EIP712("Aiverse-CheckIn-Manager", "1") Ownable(msg.sender) {
        nodeManager = INodeManager(_nodeManagerAddr);
        accountRegistrar = IAccountRegistrar(_registrarAddr);
        powerAsset = IPowerAsset(_powerAssetAddr);
    }

    function selectRandomVerifierNode(
        address userAddr
    ) external nonReentrant returns (address) {
        _checkIsNode(msg.sender);
        address[] memory nodeList = INodeManager(nodeManager).nodeList();
        require(nodeList.length > 1, "Not enough nodes to choose from");
        uint256 today = _getToday();
        require(
            verifierNodeForDay[userAddr][today] == address(0),
            "Verifier node already selected today"
        );

        uint256 randomSeed = uint256(
            keccak256(
                abi.encodePacked(
                    blockhash(block.number - 1),
                    block.prevrandao,
                    block.timestamp,
                    userAddr,
                    nonces[userAddr]
                )
            )
        );

        address verifierNode;
        uint256 attempts = 0;
        uint256 maxAttempts = 5;

        do {
            uint256 randomIndex = randomSeed % nodeList.length;
            verifierNode = nodeList[randomIndex];
            randomSeed = uint256(keccak256(abi.encodePacked(randomSeed)));
            attempts++;
            require(attempts < maxAttempts, "Failed to select verifier node");
        } while (verifierNode == msg.sender);

        verifierNodeForDay[userAddr][today] = verifierNode;
        return verifierNode;
    }

    function checkIn(
        address userAddr,
        address checkInNode,
        uint256 expireAt,
        bytes memory userSig,
        bytes memory checkInNodeSig
    ) external nonReentrant {
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
        require(INodeManager(nodeManager).isNode(addr), "Invalid Node");
    }

    function _getToday() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }
}
