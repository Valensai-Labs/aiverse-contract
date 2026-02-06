// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract BatchTransfer is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;

    IERC20 public aiHash;
    IERC20 public aiCoin;

    mapping(address => bool) public authorizedOperators;
    uint256 public maxBatchSize;

    event OperatorAuthorized(address indexed operator, bool authorized);
    event MaxBatchSizeUpdated(uint256 oldSize, uint256 newSize);
    event BatchTransferAIHASH(
        address indexed sender,
        address[] recipients,
        uint256[] amounts
    );
    event BatchTransferAICOIN(
        address indexed sender,
        address[] recipients,
        uint256[] amounts
    );

    modifier onlyAuthorized() {
        require(
            authorizedOperators[msg.sender] || msg.sender == owner(),
            "Not authorized"
        );
        _;
    }

    function initialize(
        address _aiHashAddr,
        address _aiCoinAddr,
        uint256 _maxBatchSize
    ) public virtual initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();

        require(_aiHashAddr != address(0), "Invalid AIHASH address");
        require(_aiCoinAddr != address(0), "Invalid AICOIN address");
        require(_maxBatchSize > 0, "Max batch size must be greater than 0");

        aiHash = IERC20(_aiHashAddr);
        aiCoin = IERC20(_aiCoinAddr);
        maxBatchSize = _maxBatchSize;
    }

    function version() public pure returns (string memory) {
        return "1.0.0";
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function setAuthorizedOperator(
        address operator,
        bool authorized
    ) external onlyOwner {
        require(operator != address(0), "Invalid operator address");
        authorizedOperators[operator] = authorized;
        emit OperatorAuthorized(operator, authorized);
    }

    function setMaxBatchSize(uint256 _maxBatchSize) external onlyOwner {
        require(_maxBatchSize > 0, "Max batch size must be greater than 0");
        uint256 oldSize = maxBatchSize;
        maxBatchSize = _maxBatchSize;
        emit MaxBatchSizeUpdated(oldSize, _maxBatchSize);
    }

    function batchTransferAIHASH(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant whenNotPaused onlyAuthorized {
        require(
            recipients.length == amounts.length,
            "Recipients and amounts length mismatch"
        );
        require(recipients.length > 0, "Recipients array cannot be empty");
        require(recipients.length <= maxBatchSize, "Exceeds max batch size");

        address sender = msg.sender;

        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient address");
            require(amounts[i] > 0, "Amount must be greater than 0");
            aiHash.safeTransferFrom(sender, recipients[i], amounts[i]);
        }

        emit BatchTransferAIHASH(sender, recipients, amounts);
    }

    function batchTransferAICOIN(
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant whenNotPaused onlyAuthorized {
        require(
            recipients.length == amounts.length,
            "Recipients and amounts length mismatch"
        );
        require(recipients.length > 0, "Recipients array cannot be empty");
        require(recipients.length <= maxBatchSize, "Exceeds max batch size");

        address sender = msg.sender;

        for (uint256 i = 0; i < recipients.length; i++) {
            require(recipients[i] != address(0), "Invalid recipient address");
            require(amounts[i] > 0, "Amount must be greater than 0");
            aiCoin.safeTransferFrom(sender, recipients[i], amounts[i]);
        }

        emit BatchTransferAICOIN(sender, recipients, amounts);
    }

    function getMaxBatchSize() external view returns (uint256) {
        return maxBatchSize;
    }

    function isAuthorized(address operator) external view returns (bool) {
        return authorizedOperators[operator] || operator == owner();
    }

    receive() external payable {
        revert("Direct ETH transfers not allowed");
    }

    fallback() external payable {
        revert("Fallback not allowed");
    }
}
