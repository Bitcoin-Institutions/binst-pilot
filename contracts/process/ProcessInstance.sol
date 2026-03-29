// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./ProcessTemplate.sol";

/**
 * @title ProcessInstance
 * @notice A running execution of a ProcessTemplate.
 *         Tracks step-by-step progress through an institutional process.
 *         Adapted from DeBu Studio's ProcessInstance for the BINST pilot.
 */
contract ProcessInstance {
    enum StepStatus { Pending, Completed, Rejected }

    struct StepState {
        StepStatus status;
        address actor;
        string data;      // JSON-encoded result/evidence data
        uint256 timestamp;
    }

    address public template;
    address public creator;
    uint256 public currentStepIndex;
    uint256 public totalSteps;
    bool public completed;
    uint256 public createdAt;

    mapping(uint256 => StepState) public stepStates;

    event StepExecuted(
        uint256 indexed stepIndex,
        address indexed actor,
        StepStatus status,
        string data
    );

    event ProcessCompleted(address indexed instance, uint256 timestamp);

    constructor(address _template, address _creator) {
        template = _template;
        creator = _creator;
        totalSteps = ProcessTemplate(_template).getStepCount();
        createdAt = block.timestamp;
    }

    /**
     * @notice Execute the current step
     * @param _status Whether the step is completed or rejected
     * @param _data JSON-encoded evidence/result data for this step
     */
    function executeStep(StepStatus _status, string calldata _data) external {
        require(!completed, "Process already completed");
        require(_status != StepStatus.Pending, "Cannot set status to Pending");

        stepStates[currentStepIndex] = StepState({
            status: _status,
            actor: msg.sender,
            data: _data,
            timestamp: block.timestamp
        });

        emit StepExecuted(currentStepIndex, msg.sender, _status, _data);

        if (_status == StepStatus.Completed) {
            currentStepIndex++;
            if (currentStepIndex >= totalSteps) {
                completed = true;
                emit ProcessCompleted(address(this), block.timestamp);
            }
        }
    }

    /**
     * @notice Execute a step with a cBTC payment (payable)
     * @param _data JSON-encoded evidence/result data for this step
     */
    function executeStepWithPayment(string calldata _data) external payable {
        require(!completed, "Process already completed");
        require(msg.value > 0, "Payment required");

        stepStates[currentStepIndex] = StepState({
            status: StepStatus.Completed,
            actor: msg.sender,
            data: _data,
            timestamp: block.timestamp
        });

        emit StepExecuted(currentStepIndex, msg.sender, StepStatus.Completed, _data);

        currentStepIndex++;
        if (currentStepIndex >= totalSteps) {
            completed = true;
            emit ProcessCompleted(address(this), block.timestamp);
        }
    }

    function getStepState(uint256 index) external view returns (
        StepStatus status,
        address actor,
        string memory data,
        uint256 timestamp
    ) {
        require(index < totalSteps, "Step index out of bounds");
        StepState storage s = stepStates[index];
        return (s.status, s.actor, s.data, s.timestamp);
    }

    function isCompleted() external view returns (bool) {
        return completed;
    }
}
