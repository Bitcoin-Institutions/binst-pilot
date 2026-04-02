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
 *      Authority model — Bitcoin key is sovereign:
 *        This L2 contract is a PROCESSING DELEGATE, not the root of
 *        authority. The true owner is the holder of the Bitcoin private
 *        key that controls the inscription UTXO on Bitcoin L1.
 *
 *        - inscriptionId links to the Ordinals inscription (identity root)
 *        - runeId links to the institution's membership Rune
 *        - admin (EVM address) executes logic on behalf of the BTC key holder
 *
 *        If the user switches L2s, they deploy a new contract bound to the
 *        same inscriptionId. The Bitcoin-layer identity is unchanged.
 *        See BITCOIN-IDENTITY.md for the full architecture.
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

    /// @notice Ordinals inscription ID on Bitcoin (e.g., "<txid>i0").
    ///         This is the IDENTITY ROOT — the inscription UTXO owner is
    ///         the canonical authority. This contract is a delegate.
    ///         Set after inscribing the institution on Bitcoin L1.
    string public inscriptionId;

    /// @notice Rune ID for membership token (e.g., "840000:20").
    ///         Set after etching the membership Rune on Bitcoin L1.
    string public runeId;

    /// @notice 32-byte x-only public key (BIP-340) of the admin's Bitcoin key.
    ///         Closes the trust gap: anyone can read this value and compare it
    ///         to the inscription UTXO owner on Bitcoin L1 — no oracle needed.
    ///         Set once by the admin; immutable after binding.
    bytes32 public btcPubkey;

    address[] public members;
    mapping(address => bool) public isMember;
    
    address[] public processes; // ProcessTemplates owned by this institution

    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member);
    event ProcessCreated(address indexed process, string processName, address indexed creator);
    event AdminTransferred(address indexed oldAdmin, address indexed newAdmin);
    event InscriptionIdSet(string inscriptionId);
    event RuneIdSet(string runeId);
    event BtcPubkeySet(bytes32 btcPubkey);

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

    // ── Bitcoin identity ────────────────────────────────────────────

    /**
     * @notice Link this institution to its Ordinals inscription on Bitcoin.
     *         Can only be set once (immutable after initial link).
     * @param _inscriptionId The inscription ID (e.g., "<txid>i0")
     */
    function setInscriptionId(string calldata _inscriptionId) external onlyAdmin {
        require(bytes(inscriptionId).length == 0, "Inscription ID already set");
        require(bytes(_inscriptionId).length > 0, "Empty inscription ID");
        inscriptionId = _inscriptionId;
        emit InscriptionIdSet(_inscriptionId);
    }

    /**
     * @notice Link this institution to its membership Rune on Bitcoin.
     *         Can only be set once (immutable after initial link).
     * @param _runeId The Rune ID (e.g., "840000:20")
     */
    function setRuneId(string calldata _runeId) external onlyAdmin {
        require(bytes(runeId).length == 0, "Rune ID already set");
        require(bytes(_runeId).length > 0, "Empty rune ID");
        runeId = _runeId;
        emit RuneIdSet(_runeId);
    }

    /**
     * @notice Bind this institution to the admin's Bitcoin public key.
     *         Stores the 32-byte x-only pubkey (BIP-340). Can only be set once.
     *         Once set, anyone can compare this value to the inscription UTXO
     *         owner on Bitcoin L1 — verifiable binding with no oracle.
     * @param _btcPubkey The 32-byte x-only public key
     */
    function setBtcPubkey(bytes32 _btcPubkey) external onlyAdmin {
        require(btcPubkey == bytes32(0), "BTC pubkey already set");
        require(_btcPubkey != bytes32(0), "Zero pubkey");
        btcPubkey = _btcPubkey;
        emit BtcPubkeySet(_btcPubkey);
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
