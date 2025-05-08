// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract NodeManager is Ownable, ReentrancyGuard {
    mapping(address => bool) public isNode;

    address[] public nodeList;

    event VerifierNodeSelected(
        address indexed userAddr,
        address indexed verifierNode,
        uint256 indexed day
    );
    event CheckedIn(
        address indexed userAddr,
        address indexed checkInNode,
        address indexed verifierNode,
        uint256 day
    );
    event NodeAdded(address node);
    event NodeRemoved(address node);

    modifier onlyNode() {
        require(isNode[msg.sender], "Caller is not a valid node");
        _;
    }

    constructor() Ownable(msg.sender) {}

    function addNode(address node) external onlyOwner {
        require(!isNode[node], "Node already exists");
        require(node != address(0), "Invalid node address");
        isNode[node] = true;
        nodeList.push(node);
        emit NodeAdded(node);
    }

    function removeNode(address node) external onlyOwner {
        require(isNode[node], "Node not found");
        isNode[node] = false;

        for (uint256 i = 0; i < nodeList.length; i++) {
            if (nodeList[i] == node) {
                nodeList[i] = nodeList[nodeList.length - 1];
                nodeList.pop();
                break;
            }
        }
        emit NodeRemoved(node);
    }

    function getAllNodes() external view returns (address[] memory) {
        return nodeList;
    }
}
