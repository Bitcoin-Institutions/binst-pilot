//! Map raw state diffs from batch proofs to BINST protocol entity changes.
//!
//! Given a set of known BINST contract addresses and a raw state diff
//! `(key, Option<value>)` from a `BatchProofCircuitOutputV3`, this module
//! identifies which storage slots changed and what they mean in BINST terms.
//!
//! ## Architecture
//!
//! ```text
//! BatchProofCircuitOutputV3.state_diff
//!   → filter by known BINST contract addresses
//!   → match storage slot keys to BINST field semantics
//!   → produce Vec<BinstStateChange>
//! ```
//!
//! ## Storage key format
//!
//! Citrea's `CumulativeStateDiff` uses keys of the form:
//! `<contract_address_prefix><storage_slot>` — but the exact encoding depends
//! on the state trie implementation (JMT/jellyfish merkle tree).
//!
//! For EVM storage, the key is typically:
//! `keccak256(address ++ slot)` for the global state trie, or
//! `address:slot` in a per-account storage trie.
//!
//! We support matching by suffix (the storage slot portion) when the contract
//! address is known, since the key format may vary.

use serde::{Deserialize, Serialize};

use crate::storage;

/// A meaningful state change in a BINST contract, decoded from a raw storage diff.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinstStateChange {
    /// Which contract was affected.
    pub contract: ContractKind,
    /// The contract's EVM address (20 bytes), if known.
    pub contract_address: Option<[u8; 20]>,
    /// What field changed.
    pub field: FieldChange,
    /// Raw storage slot key (hex).
    pub raw_key: String,
    /// Raw new value (hex), or None if deleted.
    pub raw_value: Option<String>,
}

/// The kind of BINST contract that was affected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContractKind {
    Institution,
    ProcessTemplate,
    ProcessInstance,
    BINSTDeployer,
    /// A contract address that we don't recognize.
    Unknown,
}

/// A decoded field-level change in a BINST contract.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum FieldChange {
    // ── Institution ──
    InstitutionName,
    InstitutionAdmin,
    InstitutionDeployer,
    InstitutionInscriptionId,
    InstitutionRuneId,
    InstitutionBtcPubkey,
    InstitutionMembersLength,
    InstitutionMemberElement { index: u64 },
    InstitutionIsMember { key_hint: String },
    InstitutionProcessesLength,
    InstitutionProcessElement { index: u64 },

    // ── ProcessTemplate ──
    TemplateName,
    TemplateDescription,
    TemplateCreator,
    TemplateStepsLength,
    TemplateInstantiationCount,
    TemplateAllInstancesLength,
    TemplateInstanceElement { index: u64 },

    // ── ProcessInstance ──
    InstanceTemplate,
    InstanceCreator,
    InstanceCurrentStepIndex,
    InstanceTotalSteps,
    InstanceCompleted,
    InstanceCreatedAt,
    InstanceStepState { step_index: u64 },

    // ── BINSTDeployer ──
    DeployerInstitutionsLength,
    DeployerInstitutionElement { index: u64 },
    DeployerProcessesLength,
    DeployerProcessElement { index: u64 },

    /// A storage slot we don't recognize.
    UnknownSlot { slot_hex: String },
}

/// A registry of known BINST contract addresses used to filter state diffs.
#[derive(Debug, Clone, Default)]
pub struct BinstRegistry {
    /// Known deployer addresses.
    pub deployers: Vec<[u8; 20]>,
    /// Known institution addresses.
    pub institutions: Vec<[u8; 20]>,
    /// Known template addresses.
    pub templates: Vec<[u8; 20]>,
    /// Known instance addresses.
    pub instances: Vec<[u8; 20]>,
}

impl BinstRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a deployer address.
    pub fn add_deployer(&mut self, addr: [u8; 20]) {
        if !self.deployers.contains(&addr) {
            self.deployers.push(addr);
        }
    }

    /// Register an institution address.
    pub fn add_institution(&mut self, addr: [u8; 20]) {
        if !self.institutions.contains(&addr) {
            self.institutions.push(addr);
        }
    }

    /// Register a process template address.
    pub fn add_template(&mut self, addr: [u8; 20]) {
        if !self.templates.contains(&addr) {
            self.templates.push(addr);
        }
    }

    /// Register a process instance address.
    pub fn add_instance(&mut self, addr: [u8; 20]) {
        if !self.instances.contains(&addr) {
            self.instances.push(addr);
        }
    }

    /// Look up which contract kind an address belongs to.
    pub fn lookup(&self, addr: &[u8; 20]) -> ContractKind {
        if self.deployers.contains(addr) {
            ContractKind::BINSTDeployer
        } else if self.institutions.contains(addr) {
            ContractKind::Institution
        } else if self.templates.contains(addr) {
            ContractKind::ProcessTemplate
        } else if self.instances.contains(addr) {
            ContractKind::ProcessInstance
        } else {
            ContractKind::Unknown
        }
    }

    /// Total number of registered addresses.
    pub fn len(&self) -> usize {
        self.deployers.len()
            + self.institutions.len()
            + self.templates.len()
            + self.instances.len()
    }

    /// Whether the registry is empty.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Check if an address is known.
    pub fn contains(&self, addr: &[u8; 20]) -> bool {
        self.lookup(addr) != ContractKind::Unknown
    }
}

/// Decode a raw state diff entry's storage slot into a BINST field change.
///
/// `slot` is the 32-byte storage slot key. We match it against known slot
/// patterns for the given contract kind.
pub fn decode_slot(kind: ContractKind, slot: &[u8; 32]) -> FieldChange {
    // Convert slot to u64 if it's a simple small slot number
    let slot_u64 = slot_to_u64(slot);

    match kind {
        ContractKind::Institution => decode_institution_slot(slot, slot_u64),
        ContractKind::ProcessTemplate => decode_template_slot(slot, slot_u64),
        ContractKind::ProcessInstance => decode_instance_slot(slot, slot_u64),
        ContractKind::BINSTDeployer => decode_deployer_slot(slot, slot_u64),
        ContractKind::Unknown => FieldChange::UnknownSlot {
            slot_hex: hex::encode(slot),
        },
    }
}

fn decode_institution_slot(slot: &[u8; 32], slot_u64: Option<u64>) -> FieldChange {
    match slot_u64 {
        Some(0) => FieldChange::InstitutionName,
        Some(1) => FieldChange::InstitutionAdmin,
        Some(2) => FieldChange::InstitutionDeployer,
        Some(3) => FieldChange::InstitutionInscriptionId,
        Some(4) => FieldChange::InstitutionRuneId,
        Some(5) => FieldChange::InstitutionBtcPubkey,
        Some(6) => FieldChange::InstitutionMembersLength,
        Some(8) => FieldChange::InstitutionProcessesLength,
        _ => {
            // Check if it's an array element
            if let Some(idx) = check_array_element(slot, storage::institution::MEMBERS_ARRAY) {
                return FieldChange::InstitutionMemberElement { index: idx };
            }
            if let Some(idx) = check_array_element(slot, storage::institution::PROCESSES_ARRAY) {
                return FieldChange::InstitutionProcessElement { index: idx };
            }
            // Could be a mapping slot (isMember)
            FieldChange::UnknownSlot {
                slot_hex: hex::encode(slot),
            }
        }
    }
}

fn decode_template_slot(slot: &[u8; 32], slot_u64: Option<u64>) -> FieldChange {
    match slot_u64 {
        Some(0) => FieldChange::TemplateName,
        Some(1) => FieldChange::TemplateDescription,
        Some(2) => FieldChange::TemplateCreator,
        Some(3) => FieldChange::TemplateStepsLength,
        Some(4) => FieldChange::TemplateInstantiationCount,
        Some(6) => FieldChange::TemplateAllInstancesLength,
        _ => {
            if let Some(idx) = check_array_element(slot, storage::template::ALL_INSTANCES_ARRAY) {
                return FieldChange::TemplateInstanceElement { index: idx };
            }
            FieldChange::UnknownSlot {
                slot_hex: hex::encode(slot),
            }
        }
    }
}

fn decode_instance_slot(slot: &[u8; 32], slot_u64: Option<u64>) -> FieldChange {
    match slot_u64 {
        Some(0) => FieldChange::InstanceTemplate,
        Some(1) => FieldChange::InstanceCreator,
        Some(2) => FieldChange::InstanceCurrentStepIndex,
        Some(3) => FieldChange::InstanceTotalSteps,
        Some(4) => FieldChange::InstanceCompleted,
        Some(5) => FieldChange::InstanceCreatedAt,
        _ => {
            // Check mapping: stepStates[step_index]
            // This is a mapping at slot 6 with uint256 keys
            // The slot is keccak256(key ++ 6)
            // We can't easily reverse this, but we can note it's an instance slot
            FieldChange::UnknownSlot {
                slot_hex: hex::encode(slot),
            }
        }
    }
}

fn decode_deployer_slot(slot: &[u8; 32], slot_u64: Option<u64>) -> FieldChange {
    match slot_u64 {
        Some(0) => FieldChange::DeployerInstitutionsLength,
        Some(1) => FieldChange::DeployerProcessesLength,
        _ => {
            if let Some(idx) =
                check_array_element(slot, storage::deployer::INSTITUTIONS_ARRAY)
            {
                return FieldChange::DeployerInstitutionElement { index: idx };
            }
            if let Some(idx) =
                check_array_element(slot, storage::deployer::DEPLOYED_PROCESSES_ARRAY)
            {
                return FieldChange::DeployerProcessElement { index: idx };
            }
            FieldChange::UnknownSlot {
                slot_hex: hex::encode(slot),
            }
        }
    }
}

/// Try to interpret a 32-byte slot as a small u64 (top 24 bytes are zero).
fn slot_to_u64(slot: &[u8; 32]) -> Option<u64> {
    if slot[..24].iter().all(|&b| b == 0) {
        Some(u64::from_be_bytes(slot[24..32].try_into().unwrap()))
    } else {
        None
    }
}

/// Check if `slot` is an element of the dynamic array at `array_slot`.
/// Returns the element index if it matches.
fn check_array_element(slot: &[u8; 32], array_slot: u64) -> Option<u64> {
    let base = storage::array_base(array_slot);
    // slot = base + index → index = slot - base
    // Only valid if slot >= base and the difference is small
    let diff = sub_words(slot, &base)?;
    if diff < 10_000 {
        // reasonable array size
        Some(diff)
    } else {
        None
    }
}

/// Subtract two 32-byte big-endian words. Returns None if a < b.
fn sub_words(a: &[u8; 32], b: &[u8; 32]) -> Option<u64> {
    let mut borrow: i128 = 0;
    let mut result = [0u8; 32];

    for i in (0..32).rev() {
        let diff = a[i] as i128 - b[i] as i128 - borrow;
        if diff < 0 {
            result[i] = (diff + 256) as u8;
            borrow = 1;
        } else {
            result[i] = diff as u8;
            borrow = 0;
        }
    }

    if borrow != 0 {
        return None; // a < b
    }

    // Check that the result fits in u64 (top 24 bytes are zero)
    if result[..24].iter().all(|&b| b == 0) {
        Some(u64::from_be_bytes(result[24..32].try_into().unwrap()))
    } else {
        None // difference too large
    }
}

/// Format a field change as a human-readable string.
impl std::fmt::Display for FieldChange {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FieldChange::InstitutionName => write!(f, "Institution.name"),
            FieldChange::InstitutionAdmin => write!(f, "Institution.admin"),
            FieldChange::InstitutionDeployer => write!(f, "Institution.deployer"),
            FieldChange::InstitutionInscriptionId => write!(f, "Institution.inscriptionId"),
            FieldChange::InstitutionRuneId => write!(f, "Institution.runeId"),
            FieldChange::InstitutionBtcPubkey => write!(f, "Institution.btcPubkey"),
            FieldChange::InstitutionMembersLength => write!(f, "Institution.members.length"),
            FieldChange::InstitutionMemberElement { index } => {
                write!(f, "Institution.members[{index}]")
            }
            FieldChange::InstitutionIsMember { key_hint } => {
                write!(f, "Institution.isMember[{key_hint}]")
            }
            FieldChange::InstitutionProcessesLength => write!(f, "Institution.processes.length"),
            FieldChange::InstitutionProcessElement { index } => {
                write!(f, "Institution.processes[{index}]")
            }
            FieldChange::TemplateName => write!(f, "ProcessTemplate.name"),
            FieldChange::TemplateDescription => write!(f, "ProcessTemplate.description"),
            FieldChange::TemplateCreator => write!(f, "ProcessTemplate.creator"),
            FieldChange::TemplateStepsLength => write!(f, "ProcessTemplate.steps.length"),
            FieldChange::TemplateInstantiationCount => {
                write!(f, "ProcessTemplate.instantiationCount")
            }
            FieldChange::TemplateAllInstancesLength => {
                write!(f, "ProcessTemplate.allInstances.length")
            }
            FieldChange::TemplateInstanceElement { index } => {
                write!(f, "ProcessTemplate.allInstances[{index}]")
            }
            FieldChange::InstanceTemplate => write!(f, "ProcessInstance.template"),
            FieldChange::InstanceCreator => write!(f, "ProcessInstance.creator"),
            FieldChange::InstanceCurrentStepIndex => write!(f, "ProcessInstance.currentStepIndex"),
            FieldChange::InstanceTotalSteps => write!(f, "ProcessInstance.totalSteps"),
            FieldChange::InstanceCompleted => write!(f, "ProcessInstance.completed"),
            FieldChange::InstanceCreatedAt => write!(f, "ProcessInstance.createdAt"),
            FieldChange::InstanceStepState { step_index } => {
                write!(f, "ProcessInstance.stepStates[{step_index}]")
            }
            FieldChange::DeployerInstitutionsLength => {
                write!(f, "BINSTDeployer.institutions.length")
            }
            FieldChange::DeployerInstitutionElement { index } => {
                write!(f, "BINSTDeployer.institutions[{index}]")
            }
            FieldChange::DeployerProcessesLength => {
                write!(f, "BINSTDeployer.deployedProcesses.length")
            }
            FieldChange::DeployerProcessElement { index } => {
                write!(f, "BINSTDeployer.deployedProcesses[{index}]")
            }
            FieldChange::UnknownSlot { slot_hex } => write!(f, "unknown(0x{slot_hex})"),
        }
    }
}

impl std::fmt::Display for ContractKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ContractKind::Institution => write!(f, "Institution"),
            ContractKind::ProcessTemplate => write!(f, "ProcessTemplate"),
            ContractKind::ProcessInstance => write!(f, "ProcessInstance"),
            ContractKind::BINSTDeployer => write!(f, "BINSTDeployer"),
            ContractKind::Unknown => write!(f, "Unknown"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slot_to_u64_simple() {
        let mut slot = [0u8; 32];
        slot[31] = 5;
        assert_eq!(slot_to_u64(&slot), Some(5));
    }

    #[test]
    fn slot_to_u64_large() {
        let slot = [0xff; 32];
        assert_eq!(slot_to_u64(&slot), None); // top bytes non-zero
    }

    #[test]
    fn decode_institution_simple_slots() {
        let mut slot = [0u8; 32];
        slot[31] = 0;
        assert!(matches!(
            decode_slot(ContractKind::Institution, &slot),
            FieldChange::InstitutionName
        ));

        slot[31] = 5;
        assert!(matches!(
            decode_slot(ContractKind::Institution, &slot),
            FieldChange::InstitutionBtcPubkey
        ));
    }

    #[test]
    fn decode_institution_members_array_element() {
        let elem0 = storage::array_element(storage::institution::MEMBERS_ARRAY, 0);
        assert!(matches!(
            decode_slot(ContractKind::Institution, &elem0),
            FieldChange::InstitutionMemberElement { index: 0 }
        ));

        let elem3 = storage::array_element(storage::institution::MEMBERS_ARRAY, 3);
        assert!(matches!(
            decode_slot(ContractKind::Institution, &elem3),
            FieldChange::InstitutionMemberElement { index: 3 }
        ));
    }

    #[test]
    fn decode_deployer_elements() {
        let elem = storage::array_element(storage::deployer::INSTITUTIONS_ARRAY, 0);
        assert!(matches!(
            decode_slot(ContractKind::BINSTDeployer, &elem),
            FieldChange::DeployerInstitutionElement { index: 0 }
        ));
    }

    #[test]
    fn decode_instance_completed() {
        let mut slot = [0u8; 32];
        slot[31] = 4;
        assert!(matches!(
            decode_slot(ContractKind::ProcessInstance, &slot),
            FieldChange::InstanceCompleted
        ));
    }

    #[test]
    fn sub_words_basic() {
        let a = storage::array_element(0, 5);
        let b = storage::array_base(0);
        assert_eq!(sub_words(&a, &b), Some(5));
    }

    #[test]
    fn sub_words_underflow() {
        let a = [0u8; 32];
        let b = [1u8; 32];
        assert_eq!(sub_words(&a, &b), None);
    }

    #[test]
    fn registry_lookup() {
        let mut reg = BinstRegistry::new();
        let addr = [0x42u8; 20];
        reg.add_institution(addr);
        assert_eq!(reg.lookup(&addr), ContractKind::Institution);
        assert_eq!(reg.lookup(&[0x00; 20]), ContractKind::Unknown);
    }
}
