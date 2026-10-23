// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

/**
 * @title BINSTProcess
 * @notice A self-contained process instance anchored to a Bitcoin L1 inscription.
 *
 * @dev Architecture: "Thin L2, Fat L1"
 *
 *      Bitcoin L1 is the source of truth for identity and definitions:
 *        - Institution inscription → admin pubkey, vault, name
 *        - ProcessTemplate inscription → step definitions, institution_id
 *
 *      This L2 contract is ONLY for execution state. It carries enough
 *      context to be self-contained — any L2 can verify it by reading
 *      the referenced Bitcoin inscription.
 *
 *      The contract is self-contained because it stores its own step
 *      definitions (copied from the L1 inscription at creation time).
 *      This means:
 *        1. No dependency on a separate ProcessTemplate contract
 *        2. No dependency on an Institution contract
 *        3. Cross-chain migration via LayerZero carries everything needed
 *
 *      Provenance chain:
 *        BINSTProcess.templateInscriptionId
 *          → look up on Bitcoin (mempool.space / ord indexer)
 *          → read inscription body → institution_id, steps, admin pubkey
 *          → verify the L1 hierarchy is intact
 *
 *      Migration via LayerZero:
 *        Source chain sends: {templateInscriptionId, steps[], currentStepIndex,
 *                            stepStates[], creator, createdAt}
 *        Destination chain deploys a new BINSTProcess pre-loaded with that state.
 */
contract BINSTProcess {
    // ── Types ────────────────────────────────────────────────────

    enum StepStatus { Pending, Completed, Rejected }

    struct Step {
        string name;
        string actionType; // "approval", "signature", "verification", "payment"
    }

    struct StepState {
        StepStatus status;
        address actor;
        string data;       // JSON-encoded evidence/result
        uint256 timestamp;
    }

    // ── L1 anchor ────────────────────────────────────────────────

    /// @notice The Ordinals inscription ID of the ProcessTemplate on Bitcoin L1.
    ///         e.g., "abcdef1234…i0". This is the provenance root — anyone can
    ///         look this up on Bitcoin to verify the template definition, the
    ///         parent institution, and the admin pubkey.
    string public templateInscriptionId;

    // ── Step definitions (copied from L1 inscription at creation) ─

    Step[] public steps;

    // ── Execution state (the only L2-native data) ────────────────

    address public creator;
    uint256 public currentStepIndex;
    bool public completed;
    uint256 public createdAt;

    mapping(uint256 => StepState) public stepStates;

    // ── Cross-chain migration state ──────────────────────────────

    /// @notice Source chain ID if this instance was migrated, 0 if native.
    uint32 public sourceChainId;

    /// @notice Address of this contract on the source chain (if migrated).
    address public sourceAddress;

    // ── Events ───────────────────────────────────────────────────

    event StepExecuted(
        uint256 indexed stepIndex,
        address indexed actor,
        StepStatus status,
        string data
    );

    event ProcessCompleted(address indexed instance, uint256 timestamp);

    event ProcessMigrated(
        uint32 indexed destinationChainId,
        address indexed sender,
        uint256 atStepIndex
    );

    // ── Constructor (fresh instance) ─────────────────────────────

    /**
     * @notice Create a new process instance from an L1 template inscription.
     * @param _templateInscriptionId  The Bitcoin inscription ID of the template
     * @param _creator               The address initiating this process
     * @param _stepNames             Step names (from L1 inscription body)
     * @param _stepActionTypes       Step action types (from L1 inscription body)
     */
    constructor(
        string memory _templateInscriptionId,
        address _creator,
        string[] memory _stepNames,
        string[] memory _stepActionTypes
    ) {
        require(bytes(_templateInscriptionId).length > 0, "Template inscription ID required");
        require(_stepNames.length > 0, "Must have at least one step");
        require(_stepNames.length == _stepActionTypes.length, "Step arrays length mismatch");
        require(_creator != address(0), "Zero creator");

        templateInscriptionId = _templateInscriptionId;
        creator = _creator;
        createdAt = block.timestamp;

        for (uint256 i = 0; i < _stepNames.length; i++) {
            steps.push(Step({
                name: _stepNames[i],
                actionType: _stepActionTypes[i]
            }));
        }
    }

    // ── Step execution ───────────────────────────────────────────

    /**
     * @notice Execute the current step.
     * @param _status  Completed (1) or Rejected (2)
     * @param _data    JSON-encoded evidence/result data
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
            if (currentStepIndex >= steps.length) {
                completed = true;
                emit ProcessCompleted(address(this), block.timestamp);
            }
        }
    }

    /**
     * @notice Execute a step with a cBTC payment (payable).
     * @param _data  JSON-encoded evidence/result data
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
        if (currentStepIndex >= steps.length) {
            completed = true;
            emit ProcessCompleted(address(this), block.timestamp);
        }
    }

    // ── Views ────────────────────────────────────────────────────

    function getStepCount() external view returns (uint256) {
        return steps.length;
    }

    function getStep(uint256 index) external view returns (
        string memory stepName,
        string memory actionType
    ) {
        require(index < steps.length, "Step index out of bounds");
        Step storage s = steps[index];
        return (s.name, s.actionType);
    }

    function getStepState(uint256 index) external view returns (
        StepStatus status,
        address actor,
        string memory data,
        uint256 timestamp
    ) {
        require(index < steps.length, "Step index out of bounds");
        StepState storage s = stepStates[index];
        return (s.status, s.actor, s.data, s.timestamp);
    }

    function totalSteps() external view returns (uint256) {
        return steps.length;
    }

    function isCompleted() external view returns (bool) {
        return completed;
    }
}
