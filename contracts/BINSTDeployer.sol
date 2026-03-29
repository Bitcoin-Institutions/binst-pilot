// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./process/ProcessTemplate.sol";
import "./Institution.sol";

/**
 * @title BINSTDeployer
 * @notice Factory/registry for the BINST protocol on Citrea.
 *         Creates institutions and process templates.
 *
 * @dev Two creation paths:
 *      1. createInstitution() → Institution contract (has members, owns processes)
 *      2. deployProcess() → standalone ProcessTemplate (backward compat, no institution)
 *
 *      The webapp reads from this contract to enumerate all institutions
 *      and all processes. Aggregated stats for an institution are read
 *      from the Institution contract itself (getProcesses → each template's
 *      instantiationCount, etc.).
 */
contract BINSTDeployer {
    // ── Institutions ─────────────────────────────────────────────
    address[] public institutions;

    event InstitutionCreated(
        address indexed institution,
        string name,
        address indexed admin,
        uint256 index
    );

    // ── Standalone processes (backward compatible) ───────────────
    address[] public deployedProcesses;

    event ProcessDeployed(
        address indexed processAddress,
        string name,
        address indexed creator,
        uint256 index
    );

    // ── Institution creation ─────────────────────────────────────

    /**
     * @notice Create a new institution. Caller becomes the admin.
     * @param _name Institution name
     */
    function createInstitution(string memory _name) external returns (address) {
        Institution inst = new Institution(_name, msg.sender);
        address instAddr = address(inst);
        institutions.push(instAddr);

        emit InstitutionCreated(instAddr, _name, msg.sender, institutions.length - 1);

        return instAddr;
    }

    function getInstitutions() external view returns (address[] memory) {
        return institutions;
    }

    function getInstitutionCount() external view returns (uint256) {
        return institutions.length;
    }

    // ── Standalone process creation (backward compatible) ────────

    /**
     * @notice Deploy a standalone process template (not bound to an institution).
     *         Kept for backward compatibility. For institutional processes,
     *         use Institution.createProcess() instead.
     */
    function deployProcess(
        string memory _name,
        string memory _description,
        string[] memory _stepNames,
        string[] memory _stepDescriptions,
        string[] memory _stepActionTypes,
        string[] memory _stepConfigs
    ) external returns (address) {
        ProcessTemplate newProcess = new ProcessTemplate(
            _name,
            _description,
            _stepNames,
            _stepDescriptions,
            _stepActionTypes,
            _stepConfigs
        );

        address processAddr = address(newProcess);
        deployedProcesses.push(processAddr);

        emit ProcessDeployed(
            processAddr,
            _name,
            msg.sender,
            deployedProcesses.length - 1
        );

        return processAddr;
    }

    function getDeployedProcesses() external view returns (address[] memory) {
        return deployedProcesses;
    }

    function getDeployedProcessCount() external view returns (uint256) {
        return deployedProcesses.length;
    }
}
