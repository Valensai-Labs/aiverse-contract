// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPowerAsset {
    function transfer(address to, uint256 amount) external;

    function transferFrom(address from, address to, uint256 amount) external;
}

contract StakeController is Ownable, EIP712, ReentrancyGuard {
    using ECDSA for bytes32;

    struct StakeInfo {
        uint256 power;
        uint256 lastSettledDay;
        uint256 unclaimedReward;
    }

    uint256 public constant SIGNATURE_EXPIRY = 1 hours;
    bytes32 private constant _STAKE_TYPEHASH =
        keccak256(
            "Stake(address userAddr,address node,uint256 amount,uint256 nonce,uint256 expireAt,address executor)"
        );
    bytes32 private constant _UNSTAKE_TYPEHASH =
        keccak256(
            "Unstake(address userAddr,address node,uint256 amount,uint256 nonce,uint256 expireAt,address executor)"
        );

    mapping(address => uint256) public nonces;
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
    event Unstaked(address indexed user, address indexed node, uint256 amount);
    event RewardClaimed(
        address indexed user,
        address indexed node,
        uint256 reward
    );

    constructor(
        address _tokenAddress,
        address _powerAssetAddr
    ) EIP712("Aiverse-Stake-Power", "1") Ownable(msg.sender) {
        tokenAddress = _tokenAddress;
        powerAssetAddr = _powerAssetAddr;
    }

    function stake(address node, uint256 amount) external nonReentrant {
        _stake(msg.sender, node, amount);
        IPowerAsset(powerAssetAddr).transfer(address(this), amount);
    }

    function stakeWithSig(
        address userAddr,
        address node,
        uint256 amount,
        uint256 expireAt,
        bytes memory userSig
    ) external nonReentrant {
        require(amount > 0, "Invalid amount");
        require(block.timestamp <= expireAt, "Signature expired");
        require(
            expireAt <= block.timestamp + SIGNATURE_EXPIRY,
            "Expiry too far in future"
        );

        bytes32 structHash = keccak256(
            abi.encode(
                _STAKE_TYPEHASH,
                userAddr,
                node,
                amount,
                nonces[userAddr],
                expireAt,
                msg.sender
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        address recovered = digest.recover(userSig);
        require(recovered == userAddr, "Invalid signature");

        nonces[userAddr]++;

        _stake(userAddr, node, amount);

        IPowerAsset(powerAssetAddr).transferFrom(
            userAddr,
            address(this),
            amount
        );
    }

    function unstake(address node, uint256 amount) external nonReentrant {
        _unstake(msg.sender, node, amount);
        IPowerAsset(powerAssetAddr).transfer(msg.sender, amount);
    }

    function unstakeWithSig(
        address userAddr,
        address node,
        uint256 amount,
        uint256 expireAt,
        bytes memory userSig
    ) external nonReentrant {
        require(amount > 0, "Invalid amount");
        require(block.timestamp <= expireAt, "Signature expired");
        require(
            expireAt <= block.timestamp + SIGNATURE_EXPIRY,
            "Expiry too far in future"
        );

        bytes32 structHash = keccak256(
            abi.encode(
                _UNSTAKE_TYPEHASH,
                userAddr,
                node,
                amount,
                nonces[userAddr],
                expireAt,
                msg.sender
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        address recovered = digest.recover(userSig);
        require(recovered == userAddr, "Invalid signature");

        nonces[userAddr]++;

        _unstake(userAddr, node, amount);

        IPowerAsset(powerAssetAddr).transferFrom(
            address(this),
            userAddr,
            amount
        );
    }

    function claimRewards() external {
        uint256 totalReward = 0;
        uint256 currentDay = block.timestamp / DAY;

        for (uint i = 0; i < userStakedNodes[msg.sender].length; i++) {
            address node = userStakedNodes[msg.sender][i];
            StakeInfo storage info = userStakeInfo[msg.sender][node];

            if (info.power == 0) {
                continue; 
            }

            _settlePendingRewards(msg.sender, node, currentDay);

            if (info.unclaimedReward > 0) {
                uint256 reward = info.unclaimedReward;
                totalReward += reward;
                info.unclaimedReward = 0;

                emit RewardClaimed(msg.sender, node, reward);
            }
        }

        require(totalReward > 0, "No rewards available to claim");
        _transferToken(msg.sender, totalReward);
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

    function _stake(address userAddr, address node, uint256 amount) internal {
        require(amount > 0, "Amount must be greater than 0");

        bool isNewStake = true;
        for (uint i = 0; i < userStakedNodes[userAddr].length; i++) {
            if (userStakedNodes[userAddr][i] == node) {
                isNewStake = false;
                break;
            }
        }
        if (isNewStake) {
            userStakedNodes[userAddr].push(node);
        }

        uint256 currentDay = block.timestamp / DAY;
        _settlePendingRewards(userAddr, node, currentDay);

        userStakeInfo[userAddr][node].power += amount;
        nodeTotalPower[node] += amount;

        emit Staked(userAddr, node, amount);
    }

    function _unstake(address userAddr, address node, uint256 amount) internal {
        require(amount > 0, "Amount must be greater than 0");
        require(
            userStakeInfo[userAddr][node].power >= amount,
            "Insufficient staked amount"
        );

        uint256 currentDay = block.timestamp / DAY;
        _settlePendingRewards(userAddr, node, currentDay);

        userStakeInfo[userAddr][node].power -= amount;
        nodeTotalPower[node] -= amount;

        emit Unstaked(userAddr, node, amount);
    }

    function _transferToken(address to, uint256 amount) internal {
        // require(IERC20(tokenAddress).transfer(to, amount), "Transfer failed");
    }

    function _settlePendingRewards(
        address userAddr,
        address node,
        uint256 currentDay
    ) internal {
        StakeInfo storage stakeInfo = userStakeInfo[userAddr][node];
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
}
