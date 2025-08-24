// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

contract NodeManagerV1_0_3 is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    address[] public nodeList;
    mapping(address => bool) public isNode;

    event NodeAdded(address node);
    event NodeRemoved(address node);

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
        return "1.0.3";
    }

    function pause() public onlyOwner {
        _pause();
    }

    function unpause() public onlyOwner {
        _unpause();
    }

    function getNodeList() external view returns (address[] memory) {
        return nodeList;
    }

    function addNode(address node) external onlyOwner whenNotPaused {
        require(!isNode[node], "Node already exists");
        require(node != address(0), "Invalid node address");
        isNode[node] = true;
        nodeList.push(node);
        emit NodeAdded(node);
    }

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
        emit NodeRemoved(node);
    }
}
