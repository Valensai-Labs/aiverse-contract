// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

/// @custom:oz-upgrades-unsafe-allow missing-initializer-call
contract AiverseCoinV1_0_5 is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ERC20Upgradeable,
    ReentrancyGuardUpgradeable,
    EIP712Upgradeable
{
    using ECDSA for bytes32;

    uint256 public constant HALVING_PERIOD_DAYS = 1460;
    uint256 public constant MAX_TOTAL_SUPPLY = 210_000_000_000 ether;
    uint256 public constant FOUNDATION_SUPPLY = 42_000_000_000 ether;

    uint256 public constant SIGNATURE_EXPIRY = 1 hours;
    bytes32 private constant _TRANSFER_TYPEHASH =
        keccak256(
            "Transfer(address from,address to,uint256 amount,uint256 nonce,uint256 chainid,uint256 expireAt,address executor)"
        );

    uint256 public initialDailyReward;
    uint256 public startDay;
    address public stakeController;
    uint256 public lastMintedDay;

    mapping(address => uint256) public nonces;
    mapping(address => bool) public whitelistAddr;

    function initialize(
        string memory name_,
        string memory symbol_,
        address foundationAddr
    ) public initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ERC20_init(name_, symbol_);
        __ReentrancyGuard_init();
        _mint(foundationAddr, FOUNDATION_SUPPLY);
        startDay = block.timestamp / 1 days;
        initialDailyReward =
            ((MAX_TOTAL_SUPPLY - FOUNDATION_SUPPLY) / 2) /
            HALVING_PERIOD_DAYS;
    }

    /// @custom:oz-upgrades-validate-as-initializer
    function initializeV2() public reinitializer(2) {
        __EIP712_init("Aiverse-Coin", "1");
    }

    function version() public pure returns (string memory) {
        return "1.0.5";
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function setStakeController(
        address _stakeController
    ) external onlyOwner whenNotPaused {
        require(
            _stakeController != address(0),
            "Invalid stake controller address"
        );
        stakeController = _stakeController;
    }

    function setWhitelistAddr(
        address account,
        bool allowed
    ) external onlyOwner whenNotPaused {
        require(account != address(0), "Invalid address");
        whitelistAddr[account] = allowed;
    }

    function transferWithSig(
        address from,
        address to,
        uint256 amount,
        uint256 expireAt,
        bytes memory fromSignature
    ) external nonReentrant whenNotPaused {
        require(whitelistAddr[msg.sender], "Caller not whitelisted");
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

    function mintToken() external nonReentrant whenNotPaused {
        require(msg.sender == stakeController, "Only StakeController can mint");
        uint256 currentDay = block.timestamp / 1 days;
        require(currentDay > lastMintedDay, "Already minted for today");

        uint256 amount = getMintAmountByDay(currentDay);
        require(
            totalSupply() + amount <= MAX_TOTAL_SUPPLY,
            "Exceeds max supply"
        );

        lastMintedDay = currentDay;
        _mint(address(this), amount);
    }

    function userClaimToken(
        address userAddr,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        require(
            msg.sender == stakeController,
            "Only StakeController can transfer"
        );
        _transfer(address(this), userAddr, amount);
    }

    function getMintAmountByDay(uint256 day) public view returns (uint256) {
        require(day >= startDay, "Invalid day");

        uint256 daysSinceStart = day - startDay;
        uint256 halvingEra = daysSinceStart / HALVING_PERIOD_DAYS;

        uint256 reward = initialDailyReward >> halvingEra;
        return reward;
    }
}
