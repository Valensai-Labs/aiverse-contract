// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAccountRegistrar {
    function userEmail(address user) external view returns (string memory);
}

contract CheckInManager is Ownable, EIP712, ReentrancyGuard {
    using ECDSA for bytes32;

    IAccountRegistrar public registrar;

    bytes32 private constant _CHECKIN_TYPEHASH =
        keccak256("CheckIn(address user,address checkInNode,uint256 nonce)");
    mapping(address => uint256) public nonces;
    mapping(address => mapping(uint256 => bool)) public checkedIn;

    mapping(address => bool) public isNode;
    address[] public nodeList;

    mapping(address => mapping(uint256 => address)) public verifierNodeForDay;

    event VerifierNodeSelected(
        address indexed userAddr,
        address indexed verifierNode,
        uint256 indexed day
    );
    event CheckedIn(
        address indexed userAddr,
        address indexed checkInNode,
        address indexed verifyNode,
        uint256 day
    );
    event NodeAdded(address node);
    event NodeRemoved(address node);

    modifier onlyNode() {
        require(isNode[msg.sender], "Caller is not a valid node");
        _;
    }

    constructor(
        address registrarAddress
    ) EIP712("Aiverse-CheckIn-Manager", "1") Ownable(msg.sender) {
        registrar = IAccountRegistrar(registrarAddress);
    }

    function addNode(address node) external onlyOwner {
        require(!isNode[node], "Node already exists");
        require(node != address(0), "Invalid node address");
        isNode[node] = true;
        nodeList.push(node);
        emit NodeAdded(node);
    }

    function removeNode(address node) external onlyOwner {
        require(isNode[node], "Node not found");
        isNode[node] = false;

        for (uint256 i = 0; i < nodeList.length; i++) {
            if (nodeList[i] == node) {
                nodeList[i] = nodeList[nodeList.length - 1];
                nodeList.pop();
                break;
            }
        }
        emit NodeRemoved(node);
    }

    function getToday() public view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function selectRandomVerifierNode(
        address userAddr
    ) external onlyNode nonReentrant returns (address) {
        require(nodeList.length > 1, "Not enough nodes to choose from");
        uint256 today = getToday();
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
        uint256 maxAttempts = 5; // 足够安全，即使只有2个节点

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
        bytes memory userSig,
        bytes memory verifierSig
    ) external onlyNode nonReentrant {
        uint256 today = getToday();

        require(
            bytes(registrar.userEmail(userAddr)).length > 0,
            "User not registered"
        );
        require(!checkedIn[userAddr][today], "Already checked in today");

        address verifierNode = verifierNodeForDay[userAddr][today];
        require(verifierNode == msg.sender, "Non-designated verifier node");

        bytes32 structHash = keccak256(
            abi.encode(
                _CHECKIN_TYPEHASH,
                userAddr,
                checkInNode,
                nonces[userAddr]
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        address recoveredUser = digest.recover(userSig);
        require(recoveredUser == userAddr, "Invalid user signature");

        address recoveredVerifier = digest.recover(verifierSig);
        require(
            recoveredVerifier == verifierNode,
            "Invalid verifier signature"
        );

        checkedIn[userAddr][today] = true;
        nonces[userAddr]++;

        emit CheckedIn(userAddr, checkInNode, msg.sender, today);
    }

    function hasCheckedInToday(address userAddr) external view returns (bool) {
        return checkedIn[userAddr][getToday()];
    }

    function getNonce(address userAddr) external view returns (uint256) {
        return nonces[userAddr];
    }

    function getVerifierNodeForToday(
        address userAddr
    ) external view returns (address) {
        return verifierNodeForDay[userAddr][getToday()];
    }

    function getAllNodes() external view returns (address[] memory) {
        return nodeList;
    }
}
