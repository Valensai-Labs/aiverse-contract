// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

/// @notice AccountRegistrar read-only hooks used to validate Particle identity during migration.
interface IAccountRegistrarEmergency {
    function emailHashToAddr(bytes32 emailHash) external view returns (address);

    function userEmailHash(address user) external view returns (bytes32);
}

/// @notice Legacy StakeController emergency hook (V1.0.13+).
interface IStakeControllerEmergency {
    function emergencyUnstakeAndClaimAll(
        address oldAddr,
        address node
    ) external;
}

/// @notice Legacy PowerAsset emergency hooks (V1.0.10+).
interface IPowerAssetEmergency {
    function emergencyTransferFrom(
        address from,
        address to,
        uint256 amount
    ) external;

    function emergencyMintCompensation(
        address newAddr,
        uint256 amount
    ) external;
}

/// @notice Legacy AiverseCoin emergency hook (V1.0.6+).
interface IAiverseCoinEmergency {
    function emergencyTransferFrom(
        address from,
        address to,
        uint256 amount
    ) external;
}

/// @title EmergencyMigrator
/// @notice Orchestrates Particle → EOA emergency migration in a single atomic transaction.
///         Migration identity uses email hash. EOA on-chain registration is out of scope.
contract EmergencyMigrator is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    EIP712Upgradeable,
    ReentrancyGuardUpgradeable
{
    using ECDSA for bytes32;

    /// @dev Must match aiverse-mvp migration EIP-712 scope and backend `MIGRATION_SCOPE_HASH`.
    bytes32 public constant MIGRATION_SCOPE_HASH =
        keccak256("PARTICLE_EXIT_FULL_V1");

    /// @dev Fixed Power (AIHASH) compensation minted once per successful migration.
    uint256 public constant MIGRATION_COMPENSATION = 500 ether;

    /// @dev Must match aiverse-mvp prepare TTL and `PREPARE_TTL_SEC`.
    uint256 public constant MAX_SIGNATURE_VALIDITY = 2 minutes;

    bytes32 private constant MIGRATION_TYPEHASH =
        keccak256(
            "Migration(bytes32 operationId,bytes32 emailHash,address oldAddr,address newAddr,address node,bytes32 scopeHash,uint256 chainId,uint256 deadline,uint256 configEpoch)"
        );

    IAccountRegistrarEmergency public accountRegistrar;
    IStakeControllerEmergency public stakeController;
    IERC20 public powerAsset;
    IERC20 public aiverseCoin;
    IPowerAssetEmergency public powerAssetEmergency;
    IAiverseCoinEmergency public aiverseCoinEmergency;

    address public migrationSigner;
    uint256 public configEpoch;
    mapping(address => bool) public relayers;
    mapping(bytes32 => bool) public migrated;

    struct MigrationRequest {
        bytes32 operationId;
        bytes32 emailHash;
        address oldAddr;
        address newAddr;
        address node;
        bytes32 scopeHash;
        uint256 deadline;
        uint256 configEpoch;
    }

    event EmergencyMigrated(
        bytes32 indexed operationId,
        bytes32 indexed emailHash,
        address indexed oldAddr,
        address newAddr,
        uint256 unstakedPower,
        uint256 claimedAicoin,
        uint256 transferredPower,
        uint256 transferredAicoin,
        uint256 compensation
    );
    event MigrationSignerUpdated(
        address indexed previousSigner,
        address indexed newSigner
    );
    event RelayerUpdated(address indexed relayer, bool allowed);
    event LinkedContractsUpdated(
        address accountRegistrar,
        address stakeController,
        address powerAsset,
        address aiverseCoin,
        uint256 configEpoch
    );

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address accountRegistrar_,
        address stakeController_,
        address powerAsset_,
        address aiverseCoin_,
        address migrationSigner_
    ) external initializer {
        require(accountRegistrar_ != address(0), "Invalid registrar");
        require(stakeController_ != address(0), "Invalid stake controller");
        require(powerAsset_ != address(0), "Invalid power asset");
        require(aiverseCoin_ != address(0), "Invalid aiverse coin");
        require(migrationSigner_ != address(0), "Invalid migration signer");

        __Ownable_init(msg.sender);
        __Pausable_init();
        __EIP712_init("EmergencyMigrator", "1");
        __ReentrancyGuard_init();

        _setLinkedContracts(
            accountRegistrar_,
            stakeController_,
            powerAsset_,
            aiverseCoin_,
            false
        );
        migrationSigner = migrationSigner_;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setMigrationSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Invalid migration signer");
        address previousSigner = migrationSigner;
        migrationSigner = newSigner;
        emit MigrationSignerUpdated(previousSigner, newSigner);
    }

    function setRelayer(address relayer, bool allowed) external onlyOwner {
        require(relayer != address(0), "Invalid relayer");
        relayers[relayer] = allowed;
        emit RelayerUpdated(relayer, allowed);
    }

    function setLinkedContracts(
        address accountRegistrar_,
        address stakeController_,
        address powerAsset_,
        address aiverseCoin_
    ) external onlyOwner {
        _setLinkedContracts(
            accountRegistrar_,
            stakeController_,
            powerAsset_,
            aiverseCoin_,
            true
        );
    }

    function isMigrated(bytes32 emailHash) external view returns (bool) {
        return migrated[emailHash];
    }

    /// @notice Execute a full Particle → EOA migration atomically.
    /// @param emailHash Migration identity (`keccak256(lower(email))`).
    /// @param operationId Correlation id for logs/events; not used for on-chain idempotency.
    function migrate(
        bytes32 operationId,
        bytes32 emailHash,
        address oldAddr,
        address newAddr,
        address node,
        bytes32 scopeHash,
        uint256 deadline,
        uint256 configEpoch_,
        bytes calldata userSig,
        bytes calldata platformSig
    ) external nonReentrant whenNotPaused onlyRelayer {
        MigrationRequest memory request = MigrationRequest({
            operationId: operationId,
            emailHash: emailHash,
            oldAddr: oldAddr,
            newAddr: newAddr,
            node: node,
            scopeHash: scopeHash,
            deadline: deadline,
            configEpoch: configEpoch_
        });
        _migrate(request, userSig, platformSig);
    }

    function _migrate(
        MigrationRequest memory request,
        bytes calldata userSig,
        bytes calldata platformSig
    ) internal {
        _validateMigrationRequest(request);
        _verifyMigrationSignatures(request, userSig, platformSig);

        migrated[request.emailHash] = true;

        uint256 walletPowerBefore = powerAsset.balanceOf(request.oldAddr);
        uint256 walletAicoinBefore = aiverseCoin.balanceOf(request.oldAddr);

        stakeController.emergencyUnstakeAndClaimAll(
            request.oldAddr,
            request.node
        );

        uint256 walletPowerAfterUnstake = powerAsset.balanceOf(request.oldAddr);
        uint256 walletAicoinAfterUnstake = aiverseCoin.balanceOf(
            request.oldAddr
        );

        if (walletPowerAfterUnstake > 0) {
            powerAssetEmergency.emergencyTransferFrom(
                request.oldAddr,
                request.newAddr,
                walletPowerAfterUnstake
            );
        }

        powerAssetEmergency.emergencyMintCompensation(
            request.newAddr,
            MIGRATION_COMPENSATION
        );

        if (walletAicoinAfterUnstake > 0) {
            aiverseCoinEmergency.emergencyTransferFrom(
                request.oldAddr,
                request.newAddr,
                walletAicoinAfterUnstake
            );
        }

        emit EmergencyMigrated(
            request.operationId,
            request.emailHash,
            request.oldAddr,
            request.newAddr,
            walletPowerAfterUnstake - walletPowerBefore,
            walletAicoinAfterUnstake - walletAicoinBefore,
            walletPowerAfterUnstake,
            walletAicoinAfterUnstake,
            MIGRATION_COMPENSATION
        );
    }

    function _validateMigrationRequest(
        MigrationRequest memory request
    ) internal view {
        require(request.emailHash != bytes32(0), "Invalid email hash");
        require(request.oldAddr != address(0), "Invalid old address");
        require(request.newAddr != address(0), "Invalid new address");
        require(request.oldAddr != request.newAddr, "Same address");
        require(block.timestamp <= request.deadline, "Signature expired");
        require(
            request.deadline <= block.timestamp + MAX_SIGNATURE_VALIDITY,
            "Expiry too far in future"
        );
        require(request.configEpoch == configEpoch, "Invalid config epoch");
        require(request.scopeHash == MIGRATION_SCOPE_HASH, "Invalid scope");
        require(!migrated[request.emailHash], "Already migrated");
        require(
            accountRegistrar.emailHashToAddr(request.emailHash) ==
                request.oldAddr,
            "Registrar old address mismatch"
        );
        require(
            accountRegistrar.userEmailHash(request.oldAddr) ==
                request.emailHash,
            "Registrar email mismatch"
        );
    }

    function _setLinkedContracts(
        address accountRegistrar_,
        address stakeController_,
        address powerAsset_,
        address aiverseCoin_,
        bool bumpConfigEpoch
    ) internal {
        require(accountRegistrar_ != address(0), "Invalid registrar");
        require(stakeController_ != address(0), "Invalid stake controller");
        require(powerAsset_ != address(0), "Invalid power asset");
        require(aiverseCoin_ != address(0), "Invalid aiverse coin");

        accountRegistrar = IAccountRegistrarEmergency(accountRegistrar_);
        stakeController = IStakeControllerEmergency(stakeController_);
        powerAsset = IERC20(powerAsset_);
        aiverseCoin = IERC20(aiverseCoin_);
        powerAssetEmergency = IPowerAssetEmergency(powerAsset_);
        aiverseCoinEmergency = IAiverseCoinEmergency(aiverseCoin_);

        if (bumpConfigEpoch) {
            configEpoch++;
        }

        emit LinkedContractsUpdated(
            accountRegistrar_,
            stakeController_,
            powerAsset_,
            aiverseCoin_,
            configEpoch
        );
    }

    function _verifyMigrationSignatures(
        MigrationRequest memory request,
        bytes calldata userSig,
        bytes calldata platformSig
    ) internal view {
        bytes32 structHash = keccak256(
            abi.encode(
                MIGRATION_TYPEHASH,
                request.operationId,
                request.emailHash,
                request.oldAddr,
                request.newAddr,
                request.node,
                request.scopeHash,
                block.chainid,
                request.deadline,
                request.configEpoch
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);

        address recoveredUser = digest.recover(userSig);
        require(recoveredUser == request.newAddr, "Invalid user signature");

        address recoveredPlatform = digest.recover(platformSig);
        require(
            recoveredPlatform == migrationSigner,
            "Invalid platform signature"
        );
    }

    modifier onlyRelayer() {
        require(relayers[msg.sender], "Caller is not a relayer");
        _;
    }
}
