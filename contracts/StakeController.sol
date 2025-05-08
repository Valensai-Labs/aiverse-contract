// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPowerAsset {
    function transfer(address to, uint256 amount) external;

    function transferFrom(address from, address to, uint256 amount) external;
}

interface INodeManager {
    function getAllNodes() external view returns (address[] memory);
    function owner() external view returns (address);
    function isNode(address addr) external view returns (bool);
}

interface IAiverseCoin {
    function getMintAmountByDay(uint256 day) external view returns (uint256);
    function userClaimToken(address userAddr, uint256 amount) external;
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
    bytes32 private constant _CLAIM_TYPEHASH =
        keccak256(
            "Claim(address userAddr,address node,uint256 nonce,uint256 expireAt,address executor)"
        );

    mapping(address => uint256) public nonces;
    mapping(uint256 => uint256) public rewardPerPower;
    mapping(address => uint256) public nodeTotalPower;
    mapping(address => uint256) public nodeLastSettledDay;
    mapping(uint256 => uint256) public totalPowerSnapshot;
    mapping(uint256 => mapping(address => uint256))
        public nodeTotalPowerSnapshot;
    mapping(address => mapping(address => StakeInfo)) public userStakeInfo;
    mapping(address => address[]) public userStakedNodes;

    uint256 public constant mineRewardPercentage = 90;

    uint256 public constant DAY = 1 days;

    uint256 public currentSnapshotDay;
    uint256 public totalPower;
    address public aicoinAddr;
    address public powerAssetAddr;
    address public nodeManagerAddr;

    event Staked(
        address indexed userAddr,
        address indexed node,
        uint256 amount
    );
    event Unstaked(
        address indexed userAddr,
        address indexed node,
        uint256 amount
    );
    event UserClaimReward(
        address indexed userAddr,
        address indexed node,
        uint256 reward
    );
    event NodeClaimReward(address indexed node, uint256 reward);

    constructor(
        address _aicoinAddr,
        address _powerAssetAddr,
        address _nodeManagerAddr
    ) EIP712("Aiverse-Stake-Controller", "1") Ownable(msg.sender) {
        aicoinAddr = _aicoinAddr;
        powerAssetAddr = _powerAssetAddr;
        nodeManagerAddr = _nodeManagerAddr;
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

    function nodeClaimReward() external {
        require(
            INodeManager(nodeManagerAddr).isNode(msg.sender),
            "Invalid Caller"
        );
        _nodeClaimReward(msg.sender);
    }

    function userClaimReward(address node) external {
        _userClaimReward(msg.sender, node);
    }

    function userClaimRewardWithSig(
        address userAddr,
        address node,
        uint256 expireAt,
        bytes memory userSig
    ) external nonReentrant {
        require(block.timestamp <= expireAt, "Signature expired");
        require(
            expireAt <= block.timestamp + SIGNATURE_EXPIRY,
            "Expiry too far in future"
        );

        bytes32 structHash = keccak256(
            abi.encode(
                _CLAIM_TYPEHASH,
                userAddr,
                node,
                nonces[userAddr],
                expireAt,
                msg.sender
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(userSig);
        require(recovered == userAddr, "Invalid signature");

        nonces[userAddr]++;

        _userClaimReward(userAddr, node);
    }

    function dailySettle() external onlyOwner {
        uint256 currentDay = block.timestamp / DAY;

        if (currentDay == currentSnapshotDay) {
            return;
        }
        totalPowerSnapshot[currentDay] = totalPower;
        uint256 totalReward = IAiverseCoin(aicoinAddr).getMintAmountByDay(
            currentDay
        );

        uint256 mineReward = (totalReward * mineRewardPercentage) / 100;
        uint256 foundationReward = totalReward - mineReward;
        _transferToken(INodeManager(nodeManagerAddr).owner(), foundationReward);

        address[] memory allNodes = INodeManager(nodeManagerAddr).getAllNodes();
        for (uint i = 0; i < allNodes.length; i++) {
            address node = allNodes[i];
            nodeTotalPowerSnapshot[currentDay][node] = nodeTotalPower[node];
        }

        uint256 unitReward = (mineReward * 1e18) / totalPower;
        rewardPerPower[currentDay] = unitReward;

        currentSnapshotDay = currentDay;
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
        _settleUserPendingRewards(userAddr, node, currentDay);

        userStakeInfo[userAddr][node].power += amount;
        nodeTotalPower[node] += amount;
        totalPower += amount;

        emit Staked(userAddr, node, amount);
    }

    function _unstake(address userAddr, address node, uint256 amount) internal {
        require(amount > 0, "Amount must be greater than 0");
        require(
            userStakeInfo[userAddr][node].power >= amount,
            "Insufficient staked amount"
        );

        uint256 currentDay = block.timestamp / DAY;
        _settleUserPendingRewards(userAddr, node, currentDay);

        userStakeInfo[userAddr][node].power -= amount;
        nodeTotalPower[node] -= amount;
        totalPower -= amount;

        emit Unstaked(userAddr, node, amount);
    }

    function _nodeClaimReward(address node) internal {
        uint256 currentDay = block.timestamp / DAY;
        uint256 lastSettledDay = nodeLastSettledDay[node];

        uint256 reward = 0;
        if (currentDay > lastSettledDay) {
            for (uint256 day = lastSettledDay + 1; day <= currentDay; day++) {
                uint256 rewardPerUnit = rewardPerPower[day];
                uint256 powerSnapShot = nodeTotalPowerSnapshot[day][node];
                reward += (rewardPerUnit * powerSnapShot) / 1e18;
            }
        }
        require(reward > 0, "No rewards available");

        nodeLastSettledDay[node] = currentDay;

        _transferToken(node, reward);
        emit NodeClaimReward(node, reward);
    }

    function _userClaimReward(address userAddr, address node) internal {
        StakeInfo storage info = userStakeInfo[userAddr][node];

        if (info.power > 0) {
            uint256 currentDay = block.timestamp / DAY;
            _settleUserPendingRewards(userAddr, node, currentDay);
        }

        uint256 reward = info.unclaimedReward;
        require(reward > 0, "No rewards available");

        info.unclaimedReward = 0;

        _transferToken(userAddr, reward);
        emit UserClaimReward(userAddr, node, reward);
    }

    function _transferToken(address to, uint256 amount) internal {
        IAiverseCoin(aicoinAddr).userClaimToken(to, amount);
    }

    function _settleUserPendingRewards(
        address userAddr,
        address node,
        uint256 currentDay
    ) internal {
        StakeInfo storage stakeInfo = userStakeInfo[userAddr][node];
        uint256 lastSettledDay = stakeInfo.lastSettledDay;
        uint256 reward = _calculateReward(
            stakeInfo.power,
            lastSettledDay,
            currentDay
        );
        if (reward > 0) {
            stakeInfo.unclaimedReward += reward;
            stakeInfo.lastSettledDay = currentDay;
        }
    }

    function _calculateReward(
        uint256 power,
        uint256 lastSettledDay,
        uint256 currentDay
    ) internal view returns (uint256) {
        uint256 totalReward = 0;
        uint256 daysSinceLastClaim = currentDay - lastSettledDay;

        if (daysSinceLastClaim > 0) {
            for (uint256 day = lastSettledDay + 1; day <= currentDay; day++) {
                uint256 rewardPerUnit = rewardPerPower[day];
                totalReward += (rewardPerUnit * power) / 1e18;
            }
        }
        return totalReward;
    }
}
