// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract PowerAsset is Ownable, EIP712, ReentrancyGuard {
    using ECDSA for bytes32;

    uint8 public constant DECIMALS = 18;
    uint256 public constant UNIT = 10 ** DECIMALS;
    uint256 public constant SIGNATURE_EXPIRY = 1 hours;
    bytes32 private constant _TRANSFER_TYPEHASH =
        keccak256(
            "Transfer(address from,address to,uint256 amount,uint256 nonce,uint256 expireAt)"
        );

    uint256 public startTime;
    uint256 public totalPower;
    address public accountRegistrar;
    address public checkInManager;

    mapping(address => uint256) public nonces;
    mapping(address => uint256) private powerBalance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Mint(address indexed to, uint256 amount);

    constructor() EIP712("Aiverse-Power-Asset", "1") Ownable(msg.sender) {
        startTime = block.timestamp;
    }

    function setAccountRegistrar(address _accountRegistrar) external onlyOwner {
        accountRegistrar = _accountRegistrar;
    }

    function setCheckInManager(address _checkInManager) external onlyOwner {
        checkInManager = _checkInManager;
    }

    function balanceOf(address userAddr) external view returns (uint256) {
        return powerBalance[userAddr];
    }

    function transfer(address to, uint256 amount) external nonReentrant {
        require(to != address(0), "Invalid address");
        require(powerBalance[msg.sender] >= amount, "Insufficient power");

        powerBalance[msg.sender] -= amount;
        powerBalance[to] += amount;

        emit Transfer(msg.sender, to, amount);
    }

    function transferWithSig(
        address from,
        address to,
        uint256 amount,
        uint256 expireAt,
        bytes memory fromSignature
    ) external nonReentrant {
        require((from != address(0)) && (to != address(0)), "Invalid address");
        require(block.timestamp <= expireAt, "Signature expired");
        require(
            expireAt <= block.timestamp + SIGNATURE_EXPIRY,
            "Expiry too far in future"
        );
        require(powerBalance[from] >= amount, "Insufficient power");

        uint256 currentNonce = nonces[from];

        bytes32 structHash = keccak256(
            abi.encode(
                _TRANSFER_TYPEHASH,
                from,
                to,
                amount,
                currentNonce,
                expireAt
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(fromSignature);
        require(recovered == from, "Invalid signature");

        nonces[from]++;
        powerBalance[from] -= amount;
        powerBalance[to] += amount;

        emit Transfer(from, to, amount);
    }

    function mintRegistrationRewards(
        address userAddr,
        address foundationNode
    ) external nonReentrant {
        require(
            msg.sender == accountRegistrar,
            "Only AccountRegistrar can mint"
        );

        uint256 divisor = 2 ** ((block.timestamp - startTime) / 4 / 365 days);

        uint256 userReward = (100 * UNIT) / divisor;
        uint256 foundationNodeReward = (25 * UNIT) / divisor;

        powerBalance[userAddr] += userReward;
        powerBalance[foundationNode] += foundationNodeReward;

        totalPower += userReward + foundationNodeReward;

        emit Mint(userAddr, userReward);
        emit Mint(foundationNode, foundationNodeReward);
    }

    function mintCheckInRewards(
        address userAddr,
        address checkInNode,
        address verifierNode
    ) external nonReentrant {
        require(msg.sender == checkInManager, "Only CheckInManager can mint");

        uint256 divisor = 2 ** ((block.timestamp - startTime) / 4 / 365 days);

        uint256 userReward = (20 * UNIT) / divisor;
        uint256 checkInNodeReward = (3 * UNIT) / divisor;
        uint256 verifierReward = (2 * UNIT) / divisor;

        powerBalance[userAddr] += userReward;
        powerBalance[checkInNode] += checkInNodeReward;
        powerBalance[verifierNode] += verifierReward;

        totalPower += userReward + checkInNodeReward + verifierReward;

        emit Mint(userAddr, userReward);
        emit Mint(checkInNode, checkInNodeReward);
        emit Mint(verifierNode, verifierReward);
    }
}
