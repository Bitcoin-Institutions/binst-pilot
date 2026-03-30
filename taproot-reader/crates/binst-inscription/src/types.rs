//! Typed BINST entity types deserialized from inscription JSON bodies.
//!
//! These mirror the JSON schema at `schema/binst-metaprotocol.json`.

use serde::{Deserialize, Serialize};

/// Top-level discriminated union — the JSON body of any `binst` inscription.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type")]
pub enum BinstEntity {
    #[serde(rename = "institution")]
    Institution(InstitutionBody),

    #[serde(rename = "process_template")]
    ProcessTemplate(ProcessTemplateBody),

    #[serde(rename = "process_instance")]
    ProcessInstance(ProcessInstanceBody),

    #[serde(rename = "step_execution")]
    StepExecution(StepExecutionBody),
}

/// JSON body for a `type: "institution"` inscription.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct InstitutionBody {
    /// Schema version (must be 0 for pilot).
    pub v: u32,

    /// Institution display name.
    pub name: String,

    /// x-only Taproot pubkey of the admin (64 hex chars).
    pub admin: String,

    /// Citrea Institution.sol contract address (optional, set after deploy).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub citrea_contract: Option<String>,

    /// Rune ID for membership token (optional, set after etching).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub membership_rune: Option<String>,

    /// Optional description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// Optional website URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub website: Option<String>,
}

/// A step definition within a process template inscription.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StepDef {
    pub name: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_type: Option<String>,
}

/// JSON body for a `type: "process_template"` inscription.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProcessTemplateBody {
    pub v: u32,
    pub name: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub citrea_contract: Option<String>,

    pub steps: Vec<StepDef>,
}

/// JSON body for a `type: "process_instance"` inscription.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProcessInstanceBody {
    pub v: u32,

    /// x-only Taproot pubkey of the instance creator.
    pub creator: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub citrea_contract: Option<String>,
}

/// JSON body for a `type: "step_execution"` inscription.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StepExecutionBody {
    pub v: u32,
    pub step_index: u64,
    pub status: String,

    /// x-only Taproot pubkey of the actor.
    pub actor: String,

    /// SHA-256 of step evidence data (optional).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_hash: Option<String>,
}

/// Parse a JSON string into a typed BINST entity.
pub fn parse_binst_body(json: &str) -> Result<BinstEntity, serde_json::Error> {
    serde_json::from_str(json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_institution() {
        let json = r#"{
            "v": 0,
            "type": "institution",
            "name": "Acme Financial",
            "admin": "a3f4b2c1d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2",
            "citrea_contract": "0x1234567890abcdef1234567890abcdef12345678"
        }"#;

        let entity = parse_binst_body(json).unwrap();
        match entity {
            BinstEntity::Institution(inst) => {
                assert_eq!(inst.name, "Acme Financial");
                assert_eq!(inst.v, 0);
                assert_eq!(inst.citrea_contract.as_deref(), Some("0x1234567890abcdef1234567890abcdef12345678"));
            }
            _ => panic!("Expected Institution"),
        }
    }

    #[test]
    fn parse_process_template() {
        let json = r#"{
            "v": 0,
            "type": "process_template",
            "name": "KYC Onboarding",
            "steps": [
                { "name": "ID Upload", "action_type": "upload" },
                { "name": "Verification", "action_type": "verification" },
                { "name": "Approval", "action_type": "approval" }
            ]
        }"#;

        let entity = parse_binst_body(json).unwrap();
        match entity {
            BinstEntity::ProcessTemplate(tmpl) => {
                assert_eq!(tmpl.name, "KYC Onboarding");
                assert_eq!(tmpl.steps.len(), 3);
                assert_eq!(tmpl.steps[0].action_type.as_deref(), Some("upload"));
            }
            _ => panic!("Expected ProcessTemplate"),
        }
    }

    #[test]
    fn parse_step_execution() {
        let json = r#"{
            "v": 0,
            "type": "step_execution",
            "step_index": 0,
            "status": "completed",
            "actor": "b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2",
            "data_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        }"#;

        let entity = parse_binst_body(json).unwrap();
        match entity {
            BinstEntity::StepExecution(step) => {
                assert_eq!(step.step_index, 0);
                assert_eq!(step.status, "completed");
                assert!(step.data_hash.is_some());
            }
            _ => panic!("Expected StepExecution"),
        }
    }

    #[test]
    fn reject_unknown_type() {
        let json = r#"{ "v": 0, "type": "unknown_entity", "name": "test" }"#;
        assert!(parse_binst_body(json).is_err());
    }
}
