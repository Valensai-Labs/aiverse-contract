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
        keccak256(
            "Registration(address userAddr,bytes32 emailHash,uint256 nonce,uint256 chainid,uint256 expireAt)"
        );

    IPowerAsset public powerAsset;

    mapping(address => bytes32) public userEmailHash;
    mapping(bytes32 => address) public emailHashToAddr;
    mapping(address => uint256) public nonces;

    event UserRegistered(address indexed user, bytes32 emailHash);

    constructor(
        address _powerAssetAddr
    ) EIP712("Aiverse-Account-Registrar", "1") Ownable(msg.sender) {
        powerAsset = IPowerAsset(_powerAssetAddr);
    }

    function registerByEmail(
        address userAddr,
        bytes32 emailHash,
        bytes memory ownerSignature,
        bytes memory userSignature,
        uint256 expireAt
    ) external onlyOwner nonReentrant {
        require(block.timestamp <= expireAt, "Signature expired");
        require(
            expireAt <= block.timestamp + SIGNATURE_EXPIRY,
            "Expiry too far in future"
        );
        require(userAddr != address(0), "Invalid user address");

        require(
            emailHashToAddr[emailHash] == address(0),
            "Email already registered"
        );
        require(
            userEmailHash[userAddr] == bytes32(0),
            "Address already registered"
        );

        _verifySignature(
            userAddr,
            emailHash,
            ownerSignature,
            owner(),
            expireAt
        );
        _verifySignature(
            userAddr,
            emailHash,
            userSignature,
            userAddr,
            expireAt
        );

        _register(userAddr, emailHash);
    }

    function _verifySignature(
        address userAddr,
        bytes32 emailHash,
        bytes memory signature,
        address expectedSigner,
        uint256 expireAt
    ) internal view {
        bytes32 structHash = keccak256(
            abi.encode(
                _REGISTRATION_TYPEHASH,
                userAddr,
                emailHash,
                nonces[userAddr],
                block.chainid,
                expireAt
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(signature);
        require(recovered == expectedSigner, "Invalid signature");
    }

    function _register(address userAddr, bytes32 emailHash) internal {
        nonces[userAddr]++;
        userEmailHash[userAddr] = emailHash;
        emailHashToAddr[emailHash] = userAddr;
        powerAsset.mintRegistrationRewards(userAddr, msg.sender);
        emit UserRegistered(userAddr, emailHash);
    }
}
