// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract AccountRegistrar is Ownable, EIP712 {
    using ECDSA for bytes32;

    bytes32 private constant _REGISTRATION_TYPEHASH =
        keccak256("Registration(address userAddr,string email,uint256 nonce)");
    mapping(address => string) public userEmail;
    mapping(string => address) public emailToAddr;
    mapping(address => uint256) public nonces;

    event UserRegistered(address indexed user, string email);
    event EmailUpdated(address indexed user, string oldEmail, string newEmail);
    event RegistrationRevoked(address indexed user, string email);

    constructor() EIP712("AccountRegistrar", "1") Ownable(msg.sender) {}

    function registerByEmail(
        address userAddr,
        string memory email,
        bytes memory ownerSignature,
        bytes memory userSignature
    ) external onlyOwner {
        require(userAddr != address(0), "Invalid user address");
        require(
            bytes(email).length > 0 && bytes(email).length <= 256,
            "Invalid email length"
        );
        require(emailToAddr[email] == address(0), "Email already registered");
        require(
            bytes(userEmail[userAddr]).length == 0,
            "Address already registered"
        );

        _verifySignature(userAddr, email, ownerSignature, owner());
        _verifySignature(userAddr, email, userSignature, userAddr);
        _register(userAddr, email);
    }

    function getAddrByEmail(string memory email) public view returns (address) {
        address addr = emailToAddr[email];
        require(addr != address(0), "No address found for this email");
        return addr;
    }

    function _verifySignature(
        address userAddr,
        string memory email,
        bytes memory signature,
        address signer
    ) internal view {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _REGISTRATION_TYPEHASH,
                    userAddr,
                    keccak256(bytes(email)),
                    nonces[userAddr]
                )
            )
        );
        address recoveredSigner = digest.recover(signature);
        require(recoveredSigner == signer, "Invalid signature");
    }

    function _register(address userAddr, string memory email) internal {
        userEmail[userAddr] = email;
        emailToAddr[email] = userAddr;
        nonces[userAddr]++;
        emit UserRegistered(userAddr, email);
    }
}
