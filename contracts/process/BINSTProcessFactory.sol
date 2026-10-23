// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./BINSTProcess.sol";

/**
 * @title BINSTProcessFactory
 * @notice Deploys BINSTProcess instances from Bitcoin L1 template inscriptions.
 *
 * @dev This is a THIN factory, not a registry. It exists only because
 *      browser wallets (MetaMask, etc.) cannot send raw CREATE bytecode
 *      via eth_sendTransaction — they need a deployed contract to call.
 *
 *      The factory does NOT mirror L1 hierarchy (no Institution, no
 *      ProcessTemplate contracts). It just deploys instances.
 *
 *      Indexing strategy: use `InstanceCreated` events to build an off-chain
 *      index. On-chain enumeration is provided as a convenience but the
 *      event log is the primary discovery mechanism.
 */
contract BINSTProcessFactory {
    // ── Events ───────────────────────────────────────────────────

    event InstanceCreated(
        address indexed instance,
        address indexed creator,
        string templateInscriptionId,
        uint256 stepCount
    );

    // ── On-chain index (convenience, not authoritative) ──────────

    /// @notice All instances ever created through this factory.
    address[] public allInstances;

    /// @notice Instances created by a specific user.
    mapping(address => address[]) public userInstances;

    /// @notice Instances for a specific template inscription ID.
    ///         Key is keccak256(templateInscriptionId) for gas efficiency.
    mapping(bytes32 => address[]) public templateInstances;

    // ── Instance creation ────────────────────────────────────────

    /**
     * @notice Deploy a new process instance from an L1 template inscription.
     *
     * @param _templateInscriptionId  Bitcoin inscription ID of the template
     *                                 (e.g., "abcdef…i0")
     * @param _stepNames              Step names from the L1 inscription body
     * @param _stepActionTypes        Step action types from the L1 inscription body
     *
     * @return The address of the deployed BINSTProcess contract
     *
     * @dev The caller provides the step data from the L1 inscription.
     *      Verification: anyone can compare these steps against the Bitcoin
     *      inscription content to detect tampering. A future upgrade could
     *      use an oracle or ZK proof for on-chain verification.
     */
    function createInstance(
        string calldata _templateInscriptionId,
        string[] calldata _stepNames,
        string[] calldata _stepActionTypes
    ) external returns (address) {
        BINSTProcess instance = new BINSTProcess(
            _templateInscriptionId,
            msg.sender,
            _stepNames,
            _stepActionTypes
        );

        address instanceAddr = address(instance);

        allInstances.push(instanceAddr);
        userInstances[msg.sender].push(instanceAddr);

        bytes32 templateKey = keccak256(bytes(_templateInscriptionId));
        templateInstances[templateKey].push(instanceAddr);

        emit InstanceCreated(
            instanceAddr,
            msg.sender,
            _templateInscriptionId,
            _stepNames.length
        );

        return instanceAddr;
    }

    // ── Views ────────────────────────────────────────────────────

    function getInstanceCount() external view returns (uint256) {
        return allInstances.length;
    }

    function getAllInstances() external view returns (address[] memory) {
        return allInstances;
    }

    function getUserInstances(address user) external view returns (address[] memory) {
        return userInstances[user];
    }

    function getTemplateInstances(string calldata _templateInscriptionId)
        external view returns (address[] memory)
    {
        bytes32 templateKey = keccak256(bytes(_templateInscriptionId));
        return templateInstances[templateKey];
    }
}
