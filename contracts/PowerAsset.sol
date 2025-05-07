// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ComputingPowerAsset is Ownable, ReentrancyGuard {
    uint8 public constant DECIMALS = 18;
    uint256 public constant UNIT = 10 ** DECIMALS;

    uint256 public startTime;
    uint256 public totalPower;
    address public accountRegistrar;
    address public checkInManager;

    mapping(address => uint256) private powerBalance;

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Mint(address indexed to, uint256 amount);

    constructor() Ownable(msg.sender) {
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
