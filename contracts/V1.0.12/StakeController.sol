// // SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface IPowerAsset {
    function transfer(address to, uint256 amount) external;

    function transferFrom(address from, address to, uint256 amount) external;
}

interface INodeManager {
    function owner() external view returns (address);

    function isNode(address addr) external view returns (bool);

    function getNodeList() external view returns (address[] memory);
}

interface IAiverseCoin {
    function getMintAmountByDay(uint256 day) external view returns (uint256);

    function mintToken() external;

    function userClaimToken(address userAddr, uint256 amount) external;
}

contract StakeControllerV1_0_12 is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    EIP712Upgradeable,
    ReentrancyGuardUpgradeable
{
    using ECDSA for bytes32;

    struct StakeInfo {
        uint256 power;
        uint256 lastSettledDay;
        uint256 unclaimedReward;
    }

    uint256 public constant SIGNATURE_EXPIRY = 1 hours;
    bytes32 private constant _STAKE_TYPEHASH =
        keccak256(
            "Stake(address userAddr,address node,uint256 amount,uint256 nonce,uint256 chainid,uint256 expireAt,address executor)"
        );
    bytes32 private constant _UNSTAKE_TYPEHASH =
        keccak256(
            "Unstake(address userAddr,address node,uint256 amount,uint256 nonce,uint256 chainid,uint256 expireAt,address executor)"
        );
    bytes32 private constant _CLAIM_TYPEHASH =
        keccak256(
            "Claim(address userAddr,address node,uint256 nonce,uint256 chainid,uint256 expireAt,address executor)"
        );

    uint256 public constant MINE_REWARD_PERCENTAGE = 95;
    uint256 constant NODE_REWARD_COEF = 20;
    uint256 constant USER_REWARD_COEF = 80;
    uint256 public constant MAX_DAYS_FOR_REWARD = 7;

    mapping(address => uint256) public nonces;
    mapping(uint256 => uint256) public rewardPerPower;
    mapping(address => uint256) public nodeTotalPower;
    mapping(address => uint256) public nodeLastSettledDay;
    mapping(uint256 => uint256) public totalPowerSnapshot;
    mapping(uint256 => mapping(address => uint256))
        public nodeTotalPowerSnapshot;
    mapping(address => mapping(address => bool)) public isUserStakedOnNode;
    mapping(address => mapping(address => StakeInfo)) public userStakeInfo;
    mapping(address => address[]) public userStakedNodes;

    uint256 public currentSnapshotDay;
    uint256 public totalPower;
    address public aicoinAddr;
    address public powerAssetAddr;
    address public nodeManagerAddr;

    address public signerAddr;

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

    function initialize(
        address _aicoinAddr,
        address _powerAssetAddr,
        address _nodeManagerAddr
    ) public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __EIP712_init("Aiverse-Stake-Controller", "1");
        __ReentrancyGuard_init();

        aicoinAddr = _aicoinAddr;
        powerAssetAddr = _powerAssetAddr;
        nodeManagerAddr = _nodeManagerAddr;
        currentSnapshotDay = _getCurrentDay();
    }

    function version() public pure returns (string memory) {
        return "1.0.12";
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function setSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Invalid signer address");
        signerAddr = newSigner;
    }

    function getUserUnclaimReward(
        address userAddr,
        address node
    ) external view returns (uint256) {
        StakeInfo memory stakeInfo = userStakeInfo[userAddr][node];
        uint256 _unsettleReward = _calculateUserReward(
            stakeInfo.power,
            stakeInfo.lastSettledDay,
            currentSnapshotDay
        );
        return _unsettleReward + stakeInfo.unclaimedReward;
    }

    function getNodeUnclaimReward(
        address node
    ) external view returns (uint256) {
        uint256 lastSettledDay = nodeLastSettledDay[node];
        return _calculateNodeReward(node, lastSettledDay, currentSnapshotDay);
    }

    function stake(
        address node,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        IPowerAsset(powerAssetAddr).transferFrom(
            msg.sender,
            address(this),
            amount
        );
        _stake(msg.sender, node, amount);
    }

    function stakeWithSig(
        address userAddr,
        address node,
        uint256 amount,
        uint256 expireAt,
        bytes memory userSig
    ) external nonReentrant whenNotPaused {
        require(amount > 0, "Invalid amount");
        _checkSigExpire(expireAt);

        bytes32 structHash = keccak256(
            abi.encode(
                _STAKE_TYPEHASH,
                userAddr,
                node,
                amount,
                nonces[userAddr],
                block.chainid,
                expireAt,
                node
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(userSig);
        require(recovered == userAddr, "Invalid signature");

        nonces[userAddr]++;

        IPowerAsset(powerAssetAddr).transferFrom(
            userAddr,
            address(this),
            amount
        );

        _stake(userAddr, node, amount);
    }

    function unstake(
        address node,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        _unstake(msg.sender, node, amount);
        IPowerAsset(powerAssetAddr).transfer(msg.sender, amount);
    }

    function unstakeWithSig(
        address userAddr,
        address node,
        uint256 amount,
        uint256 expireAt,
        bytes memory userSig
    ) external nonReentrant whenNotPaused {
        require(amount > 0, "Invalid amount");
        _checkSigExpire(expireAt);

        bytes32 structHash = keccak256(
            abi.encode(
                _UNSTAKE_TYPEHASH,
                userAddr,
                node,
                amount,
                nonces[userAddr],
                block.chainid,
                expireAt,
                node
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

    function nodeClaimReward() external nonReentrant whenNotPaused {
        _checkIsNode(msg.sender);
        _nodeClaimReward(msg.sender);
    }

    function userClaimReward(address node) external nonReentrant whenNotPaused {
        _userClaimReward(msg.sender, node);
    }

    function userClaimRewardWithSig(
        address userAddr,
        address node,
        uint256 expireAt,
        bytes memory userSig
    ) external nonReentrant whenNotPaused {
        _checkSigExpire(expireAt);

        bytes32 structHash = keccak256(
            abi.encode(
                _CLAIM_TYPEHASH,
                userAddr,
                node,
                nonces[userAddr],
                block.chainid,
                expireAt,
                node
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(userSig);
        require(recovered == userAddr, "Invalid signature");

        nonces[userAddr]++;

        _userClaimReward(userAddr, node);
    }

    function dailySettle() external nonReentrant whenNotPaused {
        require(msg.sender == signerAddr, "Caller must be the signer");
        uint256 currentDay = _getCurrentDay();
        require(currentDay > currentSnapshotDay, "Already Snapshot today");
        IAiverseCoin(aicoinAddr).mintToken();
        totalPowerSnapshot[currentDay] = totalPower;
        uint256 totalReward = IAiverseCoin(aicoinAddr).getMintAmountByDay(
            currentDay
        );
        uint256 mineReward = (totalReward * MINE_REWARD_PERCENTAGE) / 100;
        uint256 foundationReward = totalReward - mineReward;
        _transferToken(INodeManager(nodeManagerAddr).owner(), foundationReward);

        address[] memory allNodes = INodeManager(nodeManagerAddr).getNodeList();
        for (uint i = 0; i < allNodes.length; i++) {
            address node = allNodes[i];
            nodeTotalPowerSnapshot[currentDay][node] = nodeTotalPower[node];
        }

        if (totalPower > 0) {
            uint256 unitReward = (mineReward * 1e18) / totalPower;
            rewardPerPower[currentDay] = unitReward;
        } else {
            rewardPerPower[currentDay] = 0;
        }

        currentSnapshotDay = currentDay;
    }

    function _stake(address userAddr, address node, uint256 amount) internal {
        _checkIsNode(node);
        require(amount > 0, "Amount must be greater than 0");

        uint256 currentDay = currentSnapshotDay;
        if (!isUserStakedOnNode[userAddr][node]) {
            isUserStakedOnNode[userAddr][node] = true;
            userStakedNodes[userAddr].push(node);
            userStakeInfo[userAddr][node].lastSettledDay = currentDay;
        }

        _settleUserPendingRewards(userAddr, node, currentDay);

        userStakeInfo[userAddr][node].power += amount;
        nodeTotalPower[node] += amount;
        totalPower += amount;

        emit Staked(userAddr, node, amount);
    }

    function _unstake(address userAddr, address node, uint256 amount) internal {
        _checkIsNode(node);
        require(amount > 0, "Amount must be greater than 0");
        require(
            userStakeInfo[userAddr][node].power >= amount,
            "Insufficient staked amount"
        );

        uint256 currentDay = currentSnapshotDay;
        _settleUserPendingRewards(userAddr, node, currentDay);

        userStakeInfo[userAddr][node].power -= amount;
        nodeTotalPower[node] -= amount;
        totalPower -= amount;

        emit Unstaked(userAddr, node, amount);
    }

    function _nodeClaimReward(address node) internal {
        uint256 currentDay = currentSnapshotDay;
        uint256 lastSettledDay = nodeLastSettledDay[node];

        uint256 reward = _calculateNodeReward(node, lastSettledDay, currentDay);
        require(reward > 0, "No rewards available");

        nodeLastSettledDay[node] = currentDay;

        _transferToken(node, reward);
        emit NodeClaimReward(node, reward);
    }

    function _userClaimReward(address userAddr, address node) internal {
        _checkIsNode(node);
        StakeInfo storage info = userStakeInfo[userAddr][node];

        if (info.power > 0) {
            uint256 currentDay = currentSnapshotDay;
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
        uint256 reward = _calculateUserReward(
            stakeInfo.power,
            lastSettledDay,
            currentDay
        );
        if (reward > 0) {
            stakeInfo.unclaimedReward += reward;
            stakeInfo.lastSettledDay = currentDay;
        }
    }

    function _calculateNodeReward(
        address node,
        uint256 lastSettledDay,
        uint256 currentDay
    ) internal view returns (uint256) {
        uint256 nodeRewardScaled = 0;
        if (currentDay > lastSettledDay) {
            uint256 correctLastSettledDay = Math.max(
                currentDay - MAX_DAYS_FOR_REWARD,
                lastSettledDay
            );
            for (
                uint256 day = correctLastSettledDay + 1;
                day <= currentDay;
                day++
            ) {
                uint256 rewardPerUnit = rewardPerPower[day];
                uint256 powerSnapShot = nodeTotalPowerSnapshot[day][node];
                nodeRewardScaled +=
                    (rewardPerUnit * powerSnapShot * NODE_REWARD_COEF) /
                    100;
            }
        }

        return nodeRewardScaled / 1e18;
    }

    function _calculateUserReward(
        uint256 power,
        uint256 lastSettledDay,
        uint256 currentDay
    ) internal view returns (uint256) {
        uint256 userRewardScaled = 0;

        if (currentDay > lastSettledDay) {
            uint256 correctLastSettledDay = Math.max(
                currentDay - MAX_DAYS_FOR_REWARD,
                lastSettledDay
            );
            for (
                uint256 day = correctLastSettledDay + 1;
                day <= currentDay;
                day++
            ) {
                uint256 rewardPerUnit = rewardPerPower[day];
                userRewardScaled +=
                    (rewardPerUnit * power * USER_REWARD_COEF) /
                    100;
            }
        }

        return userRewardScaled / 1e18;
    }

    function _getCurrentDay() internal view returns (uint256) {
        return block.timestamp / 1 days;
    }

    function _checkIsNode(address addr) internal view {
        require(INodeManager(nodeManagerAddr).isNode(addr), "Invalid Caller");
    }

    function _checkSigExpire(uint256 expireAt) internal view {
        require(block.timestamp <= expireAt, "Signature expired");
        require(
            expireAt <= block.timestamp + SIGNATURE_EXPIRY,
            "Expiry too far in future"
        );
    }
}
