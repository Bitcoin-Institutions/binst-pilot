// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import "./process/ProcessTemplate.sol";

/**
 * @title Institution
 * @notice An on-chain institution — the core entity in the BINST protocol.
 *         An institution has a name, an admin, members, and owns process templates.
 *
 * @dev Institutions are created by BINSTDeployer. Each institution is a
 *      separate contract with its own address, making it independently
 *      verifiable on block explorers and linkable from a webapp.
 *
 *      Minimal scope for the pilot:
 *        - Admin can add/remove members
 *        - Members (and admin) can create processes
 *        - Anyone can read institution data (for webapp aggregation)
 *        - No governance, voting, or complex roles yet
 */
contract Institution {
    string public name;
    address public admin;
    address public deployer; // BINSTDeployer that created this

    address[] public members;
    mapping(address => bool) public isMember;
    
    address[] public processes; // ProcessTemplates owned by this institution

    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member);
    event ProcessCreated(address indexed process, string processName, address indexed creator);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier onlyMember() {
        require(isMember[msg.sender] || msg.sender == admin, "Not a member");
        _;
    }

    constructor(string memory _name, address _admin) {
        require(bytes(_name).length > 0, "Name required");
        require(_admin != address(0), "Zero admin");

        name = _name;
        admin = _admin;
        deployer = msg.sender;

        // Admin is automatically a member
        members.push(_admin);
        isMember[_admin] = true;
    }

    // ── Membership ───────────────────────────────────────────────

    function addMember(address _member) external onlyAdmin {
        require(_member != address(0), "Zero address");
        require(!isMember[_member], "Already a member");

        members.push(_member);
        isMember[_member] = true;

        emit MemberAdded(_member);
    }

    function removeMember(address _member) external onlyAdmin {
        require(isMember[_member], "Not a member");
        require(_member != admin, "Cannot remove admin");

        isMember[_member] = false;

        // Remove from array (swap-and-pop)
        for (uint256 i = 0; i < members.length; i++) {
            if (members[i] == _member) {
                members[i] = members[members.length - 1];
                members.pop();
                break;
            }
        }

        emit MemberRemoved(_member);
    }

    function transferAdmin(address _newAdmin) external onlyAdmin {
        require(_newAdmin != address(0), "Zero address");

        // Ensure new admin is a member (add if not)
        if (!isMember[_newAdmin]) {
            members.push(_newAdmin);
            isMember[_newAdmin] = true;
            emit MemberAdded(_newAdmin);
        }

        address oldAdmin = admin;
        admin = _newAdmin;

        emit AdminTransferred(oldAdmin, _newAdmin);
    }

    // ── Process creation ─────────────────────────────────────────

    /**
     * @notice Deploy a new process template owned by this institution.
     *         Only members can create processes.
     */
    function createProcess(
        string memory _name,
        string memory _description,
        string[] memory _stepNames,
        string[] memory _stepDescriptions,
        string[] memory _stepActionTypes,
        string[] memory _stepConfigs
    ) external onlyMember returns (address) {
        ProcessTemplate process = new ProcessTemplate(
            _name,
            _description,
            _stepNames,
            _stepDescriptions,
            _stepActionTypes,
            _stepConfigs
        );

        address processAddr = address(process);
        processes.push(processAddr);

        emit ProcessCreated(processAddr, _name, msg.sender);

        return processAddr;
    }

    // ── Views (free reads for webapp) ────────────────────────────

    function getMemberCount() external view returns (uint256) {
        return members.length;
    }

    function getMembers() external view returns (address[] memory) {
        return members;
    }

    function getProcessCount() external view returns (uint256) {
        return processes.length;
    }

    function getProcesses() external view returns (address[] memory) {
        return processes;
    }
}
