// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract NodeManagerV1_0_4 is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    address[] public nodeList;
    mapping(address => bool) public isNode;
    mapping(address => mapping(address => bool)) public nodeSigners;

    event NodeAdded(address node);
    event NodeRemoved(address node);
    event NodeSignerAdded(address indexed beneficiary, address signer);
    event NodeSignerRemoved(address indexed beneficiary, address signer);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    modifier onlyNode() {
        require(isNode[msg.sender], "Caller is not a valid node");
        _;
    }

    function initialize() public virtual initializer {
        __Ownable_init(msg.sender);
        __Pausable_init();
        __ReentrancyGuard_init();
    }

    function version() public pure returns (string memory) {
        return "1.0.4";
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    /**
     * @notice Get the list of all registered nodes
     * @return Array of node addresses
     */
    function getNodeList() external view returns (address[] memory) {
        return nodeList;
    }

    /**
     * @notice Add a new node (only owner)
     * @param node The address of the node to add
     */
    function addNode(address node) external onlyOwner whenNotPaused {
        require(!isNode[node], "Node already exists");
        require(node != address(0), "Invalid node address");
        isNode[node] = true;
        nodeList.push(node);
        emit NodeAdded(node);
    }

    /**
     * @notice Remove a node (only owner)
     * @param node The address of the node to remove
     */
    function removeNode(address node) external onlyOwner whenNotPaused {
        require(isNode[node], "Node not found");
        for (uint256 i = 0; i < nodeList.length; i++) {
            if (nodeList[i] == node) {
                nodeList[i] = nodeList[nodeList.length - 1];
                nodeList.pop();
                break;
            }
        }
        isNode[node] = false;
        // Note: Signers are not cleared here to avoid gas overflow.
        // They will be invalidated automatically since isNode[node] is false.
        emit NodeRemoved(node);
    }

    /**
     * @notice Add a signer for the calling node (beneficiary)
     * @param signer The address of the signer to add
     */
    function addNodeSigner(address signer) external onlyNode whenNotPaused {
        address beneficiary = msg.sender;
        require(signer != address(0), "Invalid signer address");
        require(signer != beneficiary, "Signer cannot be the beneficiary");
        require(!nodeSigners[beneficiary][signer], "Signer already exists");

        nodeSigners[beneficiary][signer] = true;

        emit NodeSignerAdded(beneficiary, signer);
    }

    /**
     * @notice Remove a signer for the calling node (beneficiary)
     * @param signer The address of the signer to remove
     */
    function removeNodeSigner(address signer) external onlyNode whenNotPaused {
        address beneficiary = msg.sender;
        require(nodeSigners[beneficiary][signer], "Signer not found");

        nodeSigners[beneficiary][signer] = false;

        emit NodeSignerRemoved(beneficiary, signer);
    }

    /**
     * @notice Check if an address is a valid signer for a node
     * @param beneficiary The node beneficiary address
     * @param signer The signer address to check
     * @return True if the signer is valid for the beneficiary
     */
    function isValidNodeSigner(
        address beneficiary,
        address signer
    ) external view returns (bool) {
        // Signer is only valid if beneficiary is a valid node
        return isNode[beneficiary] && nodeSigners[beneficiary][signer];
    }
}
