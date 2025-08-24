// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

interface IPowerAsset {
    function mintRegistrationRewards(
        address userAddr,
        address registrationNode
    ) external;
}

contract AccountRegistrarV1_0_2 is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    EIP712Upgradeable,
    ReentrancyGuardUpgradeable
{
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
    mapping(address => address) public referral;

    event UserRegistered(
        address indexed user,
        address indexed referer,
        bytes32 emailHash
    );

    function initialize(address _powerAssetAddr) public virtual initializer {
        __Ownable_init(msg.sender);
        __EIP712_init("Aiverse-Account-Registrar", "1");
        __Pausable_init();
        __ReentrancyGuard_init();

        powerAsset = IPowerAsset(_powerAssetAddr);
    }

    function version() public pure returns (string memory) {
        return "1.0.2";
    }

    function setPowerAsset(address _powerAssetAddr) external onlyOwner {
        require(_powerAssetAddr != address(0), "Invalid PowerAsset address");
        powerAsset = IPowerAsset(_powerAssetAddr);
    }

    function registerByEmail(
        address userAddr,
        address refererAddr,
        bytes32 emailHash,
        bytes memory ownerSignature,
        bytes memory userSignature,
        uint256 expireAt
    ) external onlyOwner nonReentrant whenNotPaused {
        require(emailHash != bytes32(0), "Invalid email hash");
        require(userAddr != address(0), "Invalid user address");
        require(refererAddr != address(0), "Invalid referer address");
        require(refererAddr != userAddr, "Self referral not allowed");

        require(block.timestamp <= expireAt, "Signature expired");
        require(
            expireAt <= block.timestamp + SIGNATURE_EXPIRY,
            "Expiry too far in future"
        );

        require(userEmailHash[refererAddr] != bytes32(0), "Invalid referer");
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

        _register(userAddr, emailHash, refererAddr);
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

    function _register(
        address userAddr,
        bytes32 emailHash,
        address refererAddr
    ) internal {
        nonces[userAddr]++;
        userEmailHash[userAddr] = emailHash;
        emailHashToAddr[emailHash] = userAddr;
        referral[userAddr] = refererAddr;
        powerAsset.mintRegistrationRewards(userAddr, msg.sender);
        emit UserRegistered(userAddr, refererAddr, emailHash);
    }
}
