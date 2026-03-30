//! BINST protocol entity types reconstructed from storage diffs.
//!
//! These types represent the protocol's domain objects as decoded from
//! Bitcoin (via Citrea state diffs).  Every type carries a
//! `bitcoin_identity` field linking it across all reachability layers:
//!
//! - **EVM address** — find it on Citrea
//! - **Bitcoin pubkey** — verify the controller on Bitcoin
//! - **Inscription ID** — look it up on any Ordinals explorer
//! - **Membership Rune ID** — check membership in any Rune wallet
//!
//! See `BITCOIN-IDENTITY.md` for the full architecture specification.

use serde::{Deserialize, Serialize};

// ── Bitcoin identity ─────────────────────────────────────────────

/// A Bitcoin-native identity that links a BINST entity across all
/// reachability layers: Citrea (EVM), Ordinals (inscriptions), and
/// Runes (membership tokens).
///
/// The struct is designed so that code starts with just `evm_address`
/// (always available from Citrea state) and progressively gains richer
/// Bitcoin identity as inscriptions and Runes are discovered.
///
/// Four layers of reachability:
/// 1. `evm_address` — find it on Citrea
/// 2. `bitcoin_pubkey` — verify the controller on Bitcoin
/// 3. `inscription_id` — look it up on any Ordinals explorer
/// 4. `membership_rune_id` — check membership in any Rune wallet
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BitcoinIdentity {
    /// The EVM address (20 bytes) of the admin / creator.
    /// Always available — derived from Citrea state.
    pub evm_address: [u8; 20],

    /// Optional x-only Taproot public key (32 bytes).
    /// When set, this is the canonical Bitcoin identity of the entity.
    /// Controls the Ordinal inscription UTXO.
    pub bitcoin_pubkey: Option<[u8; 32]>,

    /// Ordinals inscription ID (e.g., "abc123...i0").
    /// Links to the entity's permanent identity inscription on Bitcoin.
    /// Discoverable via any Ordinals explorer using `metaprotocol=binst`.
    pub inscription_id: Option<String>,

    /// Rune ID for the institution's membership token (e.g., "840000:20").
    /// A balance of ≥1 unit = membership in this institution.
    /// Discoverable via any Rune indexer or wallet.
    pub membership_rune_id: Option<String>,

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
            inscription_id: None,
            membership_rune_id: None,
            derivation_hint: None,
        }
    }

    /// Create an identity with EVM address and Bitcoin key.
    pub fn with_bitcoin_key(
        evm_address: [u8; 20],
        pubkey: [u8; 32],
        derivation_hint: Option<String>,
    ) -> Self {
        Self {
            evm_address,
            bitcoin_pubkey: Some(pubkey),
            inscription_id: None,
            membership_rune_id: None,
            derivation_hint,
        }
    }

    /// Create a full identity with all reachability layers.
    pub fn full(
        evm_address: [u8; 20],
        pubkey: [u8; 32],
        inscription_id: String,
        membership_rune_id: Option<String>,
        derivation_hint: Option<String>,
    ) -> Self {
        Self {
            evm_address,
            bitcoin_pubkey: Some(pubkey),
            inscription_id: Some(inscription_id),
            membership_rune_id,
            derivation_hint,
        }
    }

    /// Whether this identity has a Bitcoin-native key.
    pub fn has_bitcoin_key(&self) -> bool {
        self.bitcoin_pubkey.is_some()
    }

    /// Whether this identity has an Ordinals inscription.
    pub fn has_inscription(&self) -> bool {
        self.inscription_id.is_some()
    }

    /// Whether this identity has a membership Rune.
    pub fn has_membership_rune(&self) -> bool {
        self.membership_rune_id.is_some()
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
