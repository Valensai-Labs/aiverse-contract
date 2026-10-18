// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockPowerAsset {
    address public lastRegistrationNode;
    uint256 public registrationRewardMints;

    struct ActivityMint {
        address user;
        address relayerNode;
        uint256 amount;
    }

    ActivityMint public lastActivityMint;
    uint256 public activityRewardMints;

    function mintRegistrationRewards(address registrationNode) external {
        lastRegistrationNode = registrationNode;
        registrationRewardMints += 1;
    }

    function mintActivityRewards(
        address user,
        address relayerNode,
        uint256 amount
    ) external {
        lastActivityMint = ActivityMint(user, relayerNode, amount);
        activityRewardMints += 1;
    }

    address public lastPassBonusUser;
    uint256 public lastPassBonusAmount;
    uint256 public passBonusMints;

    function mintPassBonus(address userAddr, uint256 amount) external {
        lastPassBonusUser = userAddr;
        lastPassBonusAmount = amount;
        passBonusMints += 1;
    }

    address public lastCheckInUser;
    address public lastCheckInNode;
    uint256 public lastCheckInAmount;
    uint256 public checkInRewardMints;

    function mintCheckInRewards(
        address user,
        address relayerNode,
        uint256 amount
    ) external {
        lastCheckInUser = user;
        lastCheckInNode = relayerNode;
        lastCheckInAmount = amount;
        checkInRewardMints += 1;
    }
}

contract MockNodeManager {
    mapping(address => bool) public isNode;
    mapping(address => mapping(address => bool)) private _validSigner;

    function setNode(address node, bool value) external {
        isNode[node] = value;
    }

    function setValidNodeSigner(
        address node,
        address signer,
        bool value
    ) external {
        _validSigner[node][signer] = value;
    }

    function isValidNodeSigner(
        address beneficiary,
        address signer
    ) external view returns (bool) {
        return _validSigner[beneficiary][signer];
    }

    address public owner;
    address[] private _nodes;

    function setOwner(address owner_) external {
        owner = owner_;
    }

    function registerNode(address node) external {
        isNode[node] = true;
        _nodes.push(node);
    }

    function getNodeList() external view returns (address[] memory) {
        return _nodes;
    }
}

contract MockAccountRegistrar {
    mapping(address => bytes32) public userEmailHash;
    mapping(bytes32 => address) public emailHashToAddr;

    function setEmailHash(address user, bytes32 emailHash) external {
        userEmailHash[user] = emailHash;
    }

    function setEmailHashToAddr(bytes32 emailHash, address user) external {
        emailHashToAddr[emailHash] = user;
    }
}

contract MockAiverseCoin {
    mapping(address => uint256) public balanceOf;
    bool public transferShouldFail;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function setTransferShouldFail(bool shouldFail) external {
        transferShouldFail = shouldFail;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        if (transferShouldFail) {
            return false;
        }

        uint256 balance = balanceOf[msg.sender];
        require(balance >= amount, "insufficient balance");
        balanceOf[msg.sender] = balance - amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockPaymentToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(bytes32 => bool) public authorizationUsed;
    bool public permitShouldRevert;
    bool public transferWithSigShouldRevert;
    address public lastSigFrom;
    address public lastSigTo;
    uint256 public lastSigAmount;
    uint256 public lastSigDeadline;
    bytes public lastSig;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function setPermitShouldRevert(bool shouldRevert) external {
        permitShouldRevert = shouldRevert;
    }

    function setTransferWithSigShouldRevert(bool shouldRevert) external {
        transferWithSigShouldRevert = shouldRevert;
    }

    function transferWithSig(
        address from,
        address to,
        uint256 amount,
        uint256 deadline,
        bytes calldata signature
    ) external {
        require(!transferWithSigShouldRevert, "transfer failed");
        lastSigFrom = from;
        lastSigTo = to;
        lastSigAmount = amount;
        lastSigDeadline = deadline;
        lastSig = signature;
        _transfer(from, to, amount);
    }

    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256,
        uint8,
        bytes32,
        bytes32
    ) external {
        require(!permitShouldRevert, "permit failed");
        allowance[owner][spender] = value;
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256,
        uint256,
        bytes32 nonce,
        uint8,
        bytes32,
        bytes32
    ) external {
        require(to == msg.sender, "authorization receiver");
        require(!authorizationUsed[nonce], "authorization nonce used");
        authorizationUsed[nonce] = true;
        _transfer(from, to, value);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract MockMigratableAsset {
    mapping(address => uint256) public balanceOf;
    address public lastCompensationTo;
    uint256 public lastCompensationAmount;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function emergencyTransferFrom(
        address from,
        address to,
        uint256 amount
    ) external {
        require(balanceOf[from] >= amount, "insufficient");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }

    function emergencyMintCompensation(address to, uint256 amount) external {
        lastCompensationTo = to;
        lastCompensationAmount = amount;
        balanceOf[to] += amount;
    }
}

contract MockStakeController {
    MockMigratableAsset public power;
    MockMigratableAsset public aicoin;
    uint256 public powerRelease;
    uint256 public aicoinRelease;
    address public lastOldAddr;
    address public lastNode;
    bool public shouldRevert;

    constructor(address power_, address aicoin_) {
        power = MockMigratableAsset(power_);
        aicoin = MockMigratableAsset(aicoin_);
    }

    function setRelease(uint256 powerAmount, uint256 aicoinAmount) external {
        powerRelease = powerAmount;
        aicoinRelease = aicoinAmount;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function emergencyUnstakeAndClaimAll(
        address oldAddr,
        address node
    ) external {
        require(!shouldRevert, "unstake failed");
        lastOldAddr = oldAddr;
        lastNode = node;
        if (powerRelease > 0) power.mint(oldAddr, powerRelease);
        if (aicoinRelease > 0) aicoin.mint(oldAddr, aicoinRelease);
    }
}

contract MockStakePower {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external {
        _transfer(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external {
        _transfer(from, to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "insufficient");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

contract MockStakeCoin {
    uint256 public mintCalls;
    mapping(uint256 => uint256) public mintByDay;
    mapping(address => uint256) public claimed;

    function setMintAmount(uint256 day, uint256 amount) external {
        mintByDay[day] = amount;
    }

    function getMintAmountByDay(uint256 day) external view returns (uint256) {
        return mintByDay[day];
    }

    function mintToken() external {
        mintCalls += 1;
    }

    function userClaimToken(address to, uint256 amount) external {
        claimed[to] += amount;
    }
}
