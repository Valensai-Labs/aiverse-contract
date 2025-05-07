// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPowerAsset {
    function transferWithSig(
        address from,
        address to,
        uint256 amount,
        uint256 expireAt,
        bytes memory fromSignature
    ) external;
}

contract StakePower is Ownable, ReentrancyGuard {
    struct StakeInfo {
        uint256 power; 
        uint256 lastSettledDay; 
        uint256 unclaimedReward;
    }

    mapping(address => mapping(address => StakeInfo)) public userStakeInfo;
    mapping(address => address[]) public userStakedNodes;
    mapping(address => uint256) public nodeTotalPower;
    mapping(address => mapping(uint256 => uint256)) public rewardPerPower; 

    uint256 public foundationRewardPercentage = 5;
    uint256 public nodeRewardPercentage = 20;
    uint256 public userRewardPercentage = 75;

    uint256 public constant DAY = 1 days;
    uint256 public totalTokenReward;

    address public tokenAddress;
    address public powerAssetAddr;


    event Staked(address indexed user, address indexed node, uint256 amount);
    event RewardClaimed(
        address indexed user,
        address indexed node,
        uint256 reward
    );

    constructor(
        address _tokenAddress,
        address _powerAssetAddr
    ) Ownable(msg.sender) {
        tokenAddress = _tokenAddress;
        powerAssetAddr = _powerAssetAddr;
    }

    function stake(
        address userAddr,
        address node,
        uint256 amount,
        uint256 expireAt,
        bytes memory transferSig
    ) external {
        require(amount > 0, "Amount must be greater than 0");

        bool isNewStake = true;
        for (uint i = 0; i < userStakedNodes[msg.sender].length; i++) {
            if (userStakedNodes[msg.sender][i] == node) {
                isNewStake = false;
                break;
            }
        }

        if (isNewStake) {
            userStakedNodes[msg.sender].push(node);
        }

        uint256 currentDay = block.timestamp / DAY;
        _settlePendingRewards(msg.sender, node, currentDay);

        userStakeInfo[msg.sender][node].power += amount;
        userStakeInfo[msg.sender][node].lastSettledDay = currentDay;

        nodeTotalPower[node] += amount;

        IPowerAsset(powerAssetAddr).transferWithSig(
            userAddr,
            address(this),
            amount,
            expireAt,
            transferSig
        );

        emit Staked(msg.sender, node, amount);
    }

    function _settlePendingRewards(
        address user,
        address node,
        uint256 currentDay
    ) internal {
        StakeInfo storage stakeInfo = userStakeInfo[user][node];
        uint256 daysStaked = currentDay - stakeInfo.lastSettledDay;

        if (daysStaked > 0) {
            uint256 reward = _calculateReward(
                node,
                stakeInfo.power,
                daysStaked
            );
            stakeInfo.unclaimedReward += reward;
            stakeInfo.lastSettledDay = currentDay;
        }
    }

    function _calculateReward(
        address node,
        uint256 power,
        uint256 daysStaked
    ) internal view returns (uint256) {
        uint256 rewardPerUnit = rewardPerPower[node][block.timestamp / DAY];
        return (rewardPerUnit * power * daysStaked) / 1e18;
    }

    function claimRewards() external {
        uint256 totalReward = 0;

        for (uint i = 0; i < userStakedNodes[msg.sender].length; i++) {
            address node = userStakedNodes[msg.sender][i];

            uint256 currentDay = block.timestamp / DAY;
            _settlePendingRewards(msg.sender, node, currentDay);

            uint256 reward = userStakeInfo[msg.sender][node].unclaimedReward;
            if (reward > 0) {
                totalReward += reward;
                userStakeInfo[msg.sender][node].unclaimedReward = 0;
                emit RewardClaimed(msg.sender, node, reward);
            }
        }

        require(totalReward > 0, "No rewards available to claim");

        _transferToken(msg.sender, totalReward);
    }

    function _transferToken(address to, uint256 amount) internal {
        // require(IERC20(tokenAddress).transfer(to, amount), "Transfer failed");
    }

    function dailySettle() external onlyOwner {
        uint256 currentDay = block.timestamp / 1 days;

        uint256 totalPower = 0;
        for (uint i = 0; i < userStakedNodes[msg.sender].length; i++) {
            address node = userStakedNodes[msg.sender][i];
            totalPower += nodeTotalPower[node];
        }

        uint256 totalReward = totalTokenReward;

        uint256 foundationReward = (totalReward * 5) / 100;
        _transferToken(owner(), foundationReward);

        for (uint i = 0; i < userStakedNodes[msg.sender].length; i++) {
            address node = userStakedNodes[msg.sender][i];
            uint256 nodeReward = (totalReward * 20) / 100;
            uint256 nodeShare = (nodeTotalPower[node] * 100) / totalPower;
            uint256 nodeSpecificReward = (nodeReward * nodeShare) / 100;

            _transferToken(node, nodeSpecificReward);
        }

        uint256 userReward = (totalReward * 75) / 100;
        _transferToken(msg.sender, userReward);
    }
}
