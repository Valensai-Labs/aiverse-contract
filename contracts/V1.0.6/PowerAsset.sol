// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

interface IAccountRegistrar {
    function referral(address userAddr) external view returns (address);
}

contract PowerAssetV1_0_6 is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    EIP712Upgradeable,
    ReentrancyGuardUpgradeable,
    ERC20Upgradeable
{
    using ECDSA for bytes32;

    uint256 public constant SIGNATURE_EXPIRY = 1 hours;
    bytes32 private constant _TRANSFER_TYPEHASH =
        keccak256(
            "Transfer(address from,address to,uint256 amount,uint256 nonce,uint256 chainid,uint256 expireAt,address executor)"
        );

    uint256 public startTime;
    address public accountRegistrar;
    address public checkInManager;
    address public stakeController;

    mapping(address => uint256) public nonces;
    mapping(address => bool) public authorizedContracts;

    event Mint(address indexed to, uint256 amount);

    function initialize(
        string memory name_,
        string memory symbol_
    ) public virtual initializer {
        __Ownable_init(msg.sender);
        __EIP712_init("Aiverse-Power-Asset", "1");
        __Pausable_init();
        __ReentrancyGuard_init();
        __ERC20_init(name_, symbol_);
        startTime = block.timestamp;
    }

    function version() public pure returns (string memory) {
        return "1.0.6";
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function setAccountRegistrar(
        address _accountRegistrar
    ) external onlyOwner whenNotPaused {
        require(_accountRegistrar != address(0), "Invalid address");
        accountRegistrar = _accountRegistrar;
    }

    function setCheckInManager(
        address _checkInManager
    ) external onlyOwner whenNotPaused {
        require(_checkInManager != address(0), "Invalid address");
        checkInManager = _checkInManager;
    }

    function setStakeController(
        address _stakeController
    ) external onlyOwner whenNotPaused {
        require(_stakeController != address(0), "Invalid address");
        stakeController = _stakeController;
    }

    function setAuthorizedContract(
        address contractAddr,
        bool authorized
    ) external onlyOwner whenNotPaused {
        require(contractAddr != address(0), "Invalid contract address");
        authorizedContracts[contractAddr] = authorized;
    }

    function transfer(
        address to,
        uint256 amount
    ) public override nonReentrant whenNotPaused returns (bool) {
        return super.transfer(to, amount);
    }

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) public override nonReentrant whenNotPaused returns (bool) {
        require(
            msg.sender == stakeController || authorizedContracts[msg.sender],
            "Only StakeController or authorized contracts can transfer"
        );
        _transfer(from, to, amount);
        return true;
    }

    function transferWithSig(
        address from,
        address to,
        uint256 amount,
        uint256 expireAt,
        bytes memory fromSignature
    ) external nonReentrant whenNotPaused {
        require(block.timestamp <= expireAt, "Signature expired");
        require(
            expireAt <= block.timestamp + SIGNATURE_EXPIRY,
            "Expiry too far in future"
        );

        bytes32 structHash = keccak256(
            abi.encode(
                _TRANSFER_TYPEHASH,
                from,
                to,
                amount,
                nonces[from],
                block.chainid,
                expireAt,
                msg.sender
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(fromSignature);
        require(recovered == from, "Invalid signature");
        nonces[from]++;

        _transfer(from, to, amount);
    }

    function mintRegistrationRewards(
        address userAddr,
        address foundationNode
    ) external nonReentrant whenNotPaused {
        require(
            msg.sender == accountRegistrar,
            "Only AccountRegistrar can mint"
        );
        require(
            userAddr != address(0) && foundationNode != address(0),
            "Invalid address"
        );

        uint256 divisor = _getCurrentDivisor();

        uint256 userReward = (100 * 10 ** decimals()) / divisor;
        uint256 foundationNodeReward = (25 * 10 ** decimals()) / divisor;

        _mint(userAddr, userReward);
        _mint(foundationNode, foundationNodeReward);

        emit Mint(userAddr, userReward);
        emit Mint(foundationNode, foundationNodeReward);
    }

    function mintCheckInRewards(
        address userAddr,
        address relayerNode,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        require(msg.sender == checkInManager, "Only CheckInManager can mint");
        require(
            userAddr != address(0) && relayerNode != address(0),
            "Invalid address"
        );
        require(amount > 0, "Invalid amount");

        uint256 divisor = _getCurrentDivisor();

        uint256 relayerNodeReward = (20 * 10 ** decimals()) / divisor;

        _mint(userAddr, amount);
        _mint(relayerNode, relayerNodeReward);

        emit Mint(userAddr, amount);
        emit Mint(relayerNode, relayerNodeReward);

        address referer = IAccountRegistrar(accountRegistrar).referral(
            userAddr
        );
        if (referer != address(0)) {
            uint256 refererReward = ((amount * 2) / 10) / divisor;
            _mint(referer, refererReward);
            emit Mint(referer, refererReward);
        }
    }

    function _getCurrentDivisor() internal view returns (uint256) {
        uint256 yearsSinceStart = (block.timestamp - startTime) / (365 days);
        uint256 divisor = 2 ** Math.min(yearsSinceStart / 4, 255);
        require(divisor > 0, "Divisor cannot be zero");
        return divisor;
    }
}
