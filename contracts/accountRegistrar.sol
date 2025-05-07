// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPowerAsset {
    function mintRegistrationRewards(
        address userAddr,
        address registrationNode
    ) external;
}

contract AccountRegistrar is Ownable, EIP712, ReentrancyGuard {
    using ECDSA for bytes32;

    uint256 public constant SIGNATURE_EXPIRY = 1 hours;
    bytes32 private constant _REGISTRATION_TYPEHASH =
        keccak256("Registration(address userAddr,string email,uint256 nonce)");

    IPowerAsset public powerAsset;

    mapping(address => string) public userEmail;
    mapping(string => address) public emailToAddr;
    mapping(address => uint256) public nonces;

    event UserRegistered(address indexed user, string email);

    constructor(
        address _powerAssetAddr
    ) EIP712("Aiverse-Account-Registrar", "1") Ownable(msg.sender) {
        powerAsset = IPowerAsset(_powerAssetAddr);
    }

    function registerByEmail(
        address userAddr,
        string memory email,
        bytes memory ownerSignature,
        bytes memory userSignature,
        uint256 expiry
    ) external onlyOwner nonReentrant {
        require(block.timestamp <= expiry, "Signature expired");
        require(
            expiry <= block.timestamp + SIGNATURE_EXPIRY,
            "Expiry too far in future"
        );
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

        _verifySignature(userAddr, email, ownerSignature, owner(), expiry);
        _verifySignature(userAddr, email, userSignature, userAddr, expiry);
        _register(userAddr, email);
    }

    function _verifySignature(
        address userAddr,
        string memory email,
        bytes memory signature,
        address signer,
        uint256 expiry
    ) internal view {
        bytes32 digest = _hashTypedDataV4(
            keccak256(
                abi.encode(
                    _REGISTRATION_TYPEHASH,
                    userAddr,
                    keccak256(bytes(email)),
                    nonces[userAddr],
                    expiry
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
        powerAsset.mintRegistrationRewards(userAddr, msg.sender);
        emit UserRegistered(userAddr, email);
    }
}
