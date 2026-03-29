// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./ProcessInstance.sol";

/**
 * @title ProcessTemplate
 * @notice Immutable blueprint for institutional processes on Bitcoin (via Citrea).
 *         Adapted from DeBu Studio's ProcessTemplate for the BINST pilot.
 * @dev Each template defines a sequence of steps. Instances are created
 *      from templates to track actual process execution.
 */
contract ProcessTemplate {
    struct Step {
        string name;
        string description;
        string actionType; // "approval", "signature", "verification", "payment"
        string config;     // JSON-encoded step configuration
    }

    string public name;
    string public description;
    address public creator;
    Step[] public steps;
    uint256 public instantiationCount;

    // Track instances per user
    mapping(address => address[]) public userInstances;

    // All instances ever created from this template
    address[] public allInstances;

    event InstanceCreated(
        address indexed instance,
        address indexed creator,
        uint256 instanceIndex
    );

    constructor(
        string memory _name,
        string memory _description,
        string[] memory _stepNames,
        string[] memory _stepDescriptions,
        string[] memory _stepActionTypes,
        string[] memory _stepConfigs
    ) {
        require(
            _stepNames.length == _stepDescriptions.length &&
            _stepNames.length == _stepActionTypes.length &&
            _stepNames.length == _stepConfigs.length,
            "Step arrays length mismatch"
        );
        require(_stepNames.length > 0, "Must have at least one step");

        name = _name;
        description = _description;
        creator = msg.sender;

        for (uint256 i = 0; i < _stepNames.length; i++) {
            steps.push(Step({
                name: _stepNames[i],
                description: _stepDescriptions[i],
                actionType: _stepActionTypes[i],
                config: _stepConfigs[i]
            }));
        }
    }

    /**
     * @notice Create a running instance of this template
     */
    function instantiate() external returns (address) {
        ProcessInstance instance = new ProcessInstance(address(this), msg.sender);
        address instanceAddr = address(instance);

        allInstances.push(instanceAddr);
        userInstances[msg.sender].push(instanceAddr);
        instantiationCount++;

        emit InstanceCreated(instanceAddr, msg.sender, instantiationCount);
        return instanceAddr;
    }

    function getStepCount() external view returns (uint256) {
        return steps.length;
    }

    function getStep(uint256 index) external view returns (
        string memory stepName,
        string memory stepDescription,
        string memory actionType,
        string memory config
    ) {
        require(index < steps.length, "Step index out of bounds");
        Step storage s = steps[index];
        return (s.name, s.description, s.actionType, s.config);
    }

    function getUserInstances(address user) external view returns (address[] memory) {
        return userInstances[user];
    }

    function getAllInstances() external view returns (address[] memory) {
        return allInstances;
    }
}
