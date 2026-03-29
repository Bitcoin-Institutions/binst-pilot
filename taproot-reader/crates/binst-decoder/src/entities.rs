//! BINST protocol entity types reconstructed from storage diffs.
//!
//! These types represent the protocol's domain objects as decoded from
//! Bitcoin (via Citrea state diffs).  Every type carries an optional
//! `bitcoin_identity` field — a forward-compatible hook for the planned
//! Taproot-based institution identity feature.

use serde::{Deserialize, Serialize};

// ── Bitcoin identity (forward-compatible) ────────────────────────

/// A Bitcoin-native identity that can be associated with any BINST entity.
///
/// Today this is populated from the Citrea admin address (an EVM key).
/// In the future it will hold a Taproot x-only public key derived from
/// the institution admin's Bitcoin key, enabling:
///
/// - **Clementine bridge deposits** to an institution's own BTC address
/// - **Bitcoin-native verification** — "this institution is controlled by
///   the holder of this Bitcoin key"
/// - **Covenant-guarded treasuries** (OP_CTV / OP_CAT when available)
///
/// The struct is designed so that code can check `bitcoin_pubkey.is_some()`
/// to know whether full Bitcoin identity has been configured, and fall
/// back to `evm_address` otherwise.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BitcoinIdentity {
    /// The EVM address (20 bytes) of the admin / creator.
    /// Always available — derived from Citrea state.
    pub evm_address: [u8; 20],

    /// Optional x-only Taproot public key (32 bytes).
    /// When set, this is the canonical Bitcoin identity of the entity.
    /// When `None`, the entity has not yet registered a Bitcoin key.
    pub bitcoin_pubkey: Option<[u8; 32]>,

    /// Optional derivation path or label for the key.
    /// Useful for HD wallets: e.g. "m/86'/0'/0'/0/0".
    pub derivation_hint: Option<String>,
}

impl BitcoinIdentity {
    /// Create an identity from just an EVM address (no Bitcoin key yet).
    pub fn from_evm(address: [u8; 20]) -> Self {
        Self {
            evm_address: address,
            bitcoin_pubkey: None,
            derivation_hint: None,
        }
    }

    /// Create a full identity with both EVM and Bitcoin keys.
    pub fn with_bitcoin_key(
        evm_address: [u8; 20],
        pubkey: [u8; 32],
        derivation_hint: Option<String>,
    ) -> Self {
        Self {
            evm_address,
            bitcoin_pubkey: Some(pubkey),
            derivation_hint,
        }
    }

    /// Whether this identity has a Bitcoin-native key.
    pub fn has_bitcoin_key(&self) -> bool {
        self.bitcoin_pubkey.is_some()
    }

    /// Return the Taproot address (bech32m) if a Bitcoin key is set.
    /// Placeholder — actual encoding requires network param and bech32m.
    pub fn taproot_address_hint(&self) -> Option<String> {
        self.bitcoin_pubkey.map(|pk| format!("tb1p{}", hex::encode(&pk[..20])))
    }
}

// ── Protocol entities ────────────────────────────────────────────

/// A BINST Institution reconstructed from storage diffs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstitutionState {
    /// Citrea contract address of this Institution.
    pub contract_address: [u8; 20],

    /// Institution name (from storage slot 0).
    pub name: Option<String>,

    /// Admin identity.
    pub admin: Option<BitcoinIdentity>,

    /// Deployer address (the BINSTDeployer that created this).
    pub deployer: Option<[u8; 20]>,

    /// Known members (from the members array).
    pub members: Vec<BitcoinIdentity>,

    /// Addresses of ProcessTemplate contracts owned by this institution.
    pub process_addresses: Vec<[u8; 20]>,

    /// The Bitcoin block height where we first observed this institution's
    /// state changes.  Useful for anchoring: "this institution was committed
    /// to Bitcoin at height N."
    pub first_seen_btc_height: Option<u64>,

    /// The most recent Bitcoin block height with state changes.
    pub last_seen_btc_height: Option<u64>,
}

impl InstitutionState {
    pub fn new(contract_address: [u8; 20]) -> Self {
        Self {
            contract_address,
            name: None,
            admin: None,
            deployer: None,
            members: Vec::new(),
            process_addresses: Vec::new(),
            first_seen_btc_height: None,
            last_seen_btc_height: None,
        }
    }

    /// Record that this institution was observed at a Bitcoin height.
    pub fn touch(&mut self, btc_height: u64) {
        if self.first_seen_btc_height.is_none() {
            self.first_seen_btc_height = Some(btc_height);
        }
        self.last_seen_btc_height = Some(btc_height);
    }
}

/// A ProcessTemplate reconstructed from storage diffs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessTemplateState {
    /// Citrea contract address.
    pub contract_address: [u8; 20],

    /// Template name.
    pub name: Option<String>,

    /// Template description.
    pub description: Option<String>,

    /// Creator identity.
    pub creator: Option<BitcoinIdentity>,

    /// Number of steps in the template.
    pub step_count: Option<u64>,

    /// Step names (if decoded from storage).
    pub step_names: Vec<String>,

    /// How many instances have been created from this template.
    pub instantiation_count: Option<u64>,

    /// Addresses of all ProcessInstance contracts.
    pub instance_addresses: Vec<[u8; 20]>,

    /// Owning institution address (if known from the registry).
    pub institution: Option<[u8; 20]>,

    pub first_seen_btc_height: Option<u64>,
    pub last_seen_btc_height: Option<u64>,
}

impl ProcessTemplateState {
    pub fn new(contract_address: [u8; 20]) -> Self {
        Self {
            contract_address,
            name: None,
            description: None,
            creator: None,
            step_count: None,
            step_names: Vec::new(),
            instantiation_count: None,
            instance_addresses: Vec::new(),
            institution: None,
            first_seen_btc_height: None,
            last_seen_btc_height: None,
        }
    }
}

/// A ProcessInstance reconstructed from storage diffs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInstanceState {
    /// Citrea contract address.
    pub contract_address: [u8; 20],

    /// The ProcessTemplate this instance was created from.
    pub template_address: Option<[u8; 20]>,

    /// Creator identity.
    pub creator: Option<BitcoinIdentity>,

    /// Current step index (0-based).
    pub current_step: Option<u64>,

    /// Total number of steps.
    pub total_steps: Option<u64>,

    /// Whether all steps are completed.
    pub completed: Option<bool>,

    /// Creation timestamp (block.timestamp from Citrea).
    pub created_at: Option<u64>,

    /// Per-step execution records.
    pub step_executions: Vec<StepExecution>,

    pub first_seen_btc_height: Option<u64>,
    pub last_seen_btc_height: Option<u64>,
}

/// A single step execution record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepExecution {
    pub step_index: u64,
    pub status: StepStatus,
    pub actor: Option<BitcoinIdentity>,
    pub timestamp: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum StepStatus {
    Pending,
    Completed,
    Rejected,
}

impl ProcessInstanceState {
    pub fn new(contract_address: [u8; 20]) -> Self {
        Self {
            contract_address,
            template_address: None,
            creator: None,
            current_step: None,
            total_steps: None,
            completed: None,
            created_at: None,
            step_executions: Vec::new(),
            first_seen_btc_height: None,
            last_seen_btc_height: None,
        }
    }

    /// Computed progress percentage.
    pub fn progress_percent(&self) -> Option<f64> {
        match (self.current_step, self.total_steps) {
            (Some(current), Some(total)) if total > 0 => {
                Some((current as f64 / total as f64) * 100.0)
            }
            _ => None,
        }
    }
}

// ── Aggregate view ───────────────────────────────────────────────

/// The complete protocol state reconstructed from Bitcoin.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProtocolState {
    /// BINSTDeployer contract address.
    pub deployer_address: Option<[u8; 20]>,

    /// All known institutions.
    pub institutions: Vec<InstitutionState>,

    /// All known process templates.
    pub templates: Vec<ProcessTemplateState>,

    /// All known process instances.
    pub instances: Vec<ProcessInstanceState>,

    /// The latest Bitcoin block height we have processed.
    pub tip_btc_height: Option<u64>,

    /// The latest sequencer commitment index we have seen.
    pub tip_commitment_index: Option<u32>,
}
