// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract AccountRegistrar {
    address payable public owner;
    // 用户地址到邮箱的映射
    mapping(address => string) public userEmail;
    // 邮箱到用户地址的反向映射
    mapping(string => address) public emailToAddr;

    event UserRegistered(address indexed user, string email);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can execute this.");
        _;
    }

    constructor() {
        owner = payable(msg.sender);
    }

    // 用户注册功能
    function registerByEmail(
        address userAddr,
        string memory email,
        bytes memory ownerSignature,
        bytes memory userSignature
    ) public onlyOwner {
        // 检查邮箱是否已被注册
        require(emailToAddr[email] == address(0), "Email already registered.");

        // 验证合约拥有者签名和用户签名
        require(
            verifySignature(userAddr, email, ownerSignature, owner),
            "Invalid owner signature."
        );
        require(
            verifySignature(userAddr, email, userSignature, userAddr),
            "Invalid user signature."
        );

        // 绑定邮箱与地址
        userEmail[userAddr] = email;
        emailToAddr[email] = userAddr;

        // 触发注册事件
        emit UserRegistered(userAddr, email);
    }

    // 根据邮箱查询地址
    function getAddrByEmail(string memory email) public view returns (address) {
        require(
            emailToAddr[email] != address(0),
            "No address found for this email."
        );
        return emailToAddr[email];
    }

    // 验证签名
    function verifySignature(
        address userAddr,
        string memory email,
        bytes memory signature,
        address signer
    ) internal pure returns (bool) {
        bytes32 messageHash = getMessageHash(userAddr, email);
        address recoveredSigner = recoverSigner(messageHash, signature);
        return recoveredSigner == signer;
    }

    // 获取消息的哈希
    function getMessageHash(
        address userAddr,
        string memory email
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(userAddr, email));
    }

    // 从签名恢复签名者地址
    function recoverSigner(
        bytes32 messageHash,
        bytes memory signature
    ) internal pure returns (address) {
        (bytes32 r, bytes32 s, uint8 v) = splitSignature(signature);
        return ecrecover(messageHash, v, r, s);
    }

    // 将签名拆分为r, s, v
    function splitSignature(
        bytes memory sig
    ) internal pure returns (bytes32 r, bytes32 s, uint8 v) {
        require(sig.length == 65, "invalid signature length");

        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
    }
}
