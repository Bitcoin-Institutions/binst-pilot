//! Citrea L2 RPC client — queries batch proofs + state diffs directly from a
//! Citrea full node, bypassing Bitcoin block scanning entirely.
//!
//! Key RPCs:
//!   • `ledger_getVerifiedBatchProofsBySlotHeight(btcBlockHeight)` — returns
//!     proven batch proofs (with state diffs) anchored to a Bitcoin block.
//!   • `ledger_getSequencerCommitmentsOnSlotByNumber(btcBlockHeight)` — returns
//!     sequencer commitments (merkle root, L2 end block).
//!   • `citrea_getLastProvenL2Height` / `citrea_getLastCommittedL2Height`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

// ── JSON-RPC types ──────────────────────────────────────────────

#[derive(Serialize)]
struct JsonRpcRequest<'a> {
    jsonrpc: &'a str,
    method: &'a str,
    params: Value,
    id: u64,
}

#[derive(Deserialize)]
struct JsonRpcResponse {
    result: Option<Value>,
    error: Option<Value>,
    #[allow(dead_code)]
    id: Option<u64>,
}

// ── Deserialized Citrea types ───────────────────────────────────

/// Proof output as returned by `ledger_getVerifiedBatchProofsBySlotHeight`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcBatchProof {
    pub proof_output: RpcProofOutput,
    // `proof` field omitted — we only need the decoded output
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcProofOutput {
    pub state_roots: Vec<String>,
    pub final_l2_block_hash: String,
    /// Hex-keyed map: `"0x452f..." → "0xabcd..."`
    pub state_diff: serde_json::Map<String, Value>,
}

/// Sequencer commitment as returned by `ledger_getSequencerCommitmentsOnSlotByNumber`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct RpcSequencerCommitment {
    pub merkle_root: String,
    pub index: String,
    pub l2_end_block_number: String,
}

/// Result of `citrea_getLastProvenL2Height`.
#[derive(Debug, Clone, Deserialize)]
pub struct ProvenHeight {
    pub height: u64,
    pub commitment_index: u64,
}

// ── Client ──────────────────────────────────────────────────────

/// Minimal synchronous Citrea RPC client.
pub struct CitreaClient {
    url: String,
    next_id: std::cell::Cell<u64>,
}

impl CitreaClient {
    pub fn new(url: &str) -> Self {
        Self {
            url: url.to_string(),
            next_id: std::cell::Cell::new(1),
        }
    }

    fn call(&self, method: &str, params: Value) -> Result<Value, Box<dyn std::error::Error>> {
        let id = self.next_id.get();
        self.next_id.set(id + 1);

        let req = JsonRpcRequest {
            jsonrpc: "2.0",
            method,
            params,
            id,
        };

        let resp: JsonRpcResponse = ureq::post(&self.url)
            .set("Content-Type", "application/json")
            .send_json(serde_json::to_value(&req)?)?
            .into_json()?;

        if let Some(err) = resp.error {
            return Err(format!("RPC error: {err}").into());
        }

        // Return Value::Null instead of Err when result is null —
        // some RPCs legitimately return null (e.g. no proofs for a block).
        Ok(resp.result.unwrap_or(Value::Null))
    }

    // ── High-level methods ──────────────────────────────────────

    /// Get verified batch proofs for a given Bitcoin block height.
    /// Returns an empty vec when the RPC returns null (no proofs for that block).
    pub fn get_verified_batch_proofs(
        &self,
        btc_height: u64,
    ) -> Result<Vec<RpcBatchProof>, Box<dyn std::error::Error>> {
        let val = self.call(
            "ledger_getVerifiedBatchProofsBySlotHeight",
            serde_json::json!([btc_height]),
        )?;
        if val.is_null() {
            return Ok(Vec::new());
        }
        let proofs: Vec<RpcBatchProof> = serde_json::from_value(val)?;
        Ok(proofs)
    }

    /// Get sequencer commitments for a given Bitcoin block height.
    #[allow(dead_code)]
    pub fn get_sequencer_commitments(
        &self,
        btc_height: u64,
    ) -> Result<Vec<RpcSequencerCommitment>, Box<dyn std::error::Error>> {
        let val = self.call(
            "ledger_getSequencerCommitmentsOnSlotByNumber",
            serde_json::json!([btc_height]),
        )?;
        let commits: Vec<RpcSequencerCommitment> = serde_json::from_value(val)?;
        Ok(commits)
    }

    /// Get the last proven L2 height.
    pub fn get_last_proven_height(
        &self,
    ) -> Result<ProvenHeight, Box<dyn std::error::Error>> {
        let val = self.call("citrea_getLastProvenL2Height", serde_json::json!([]))?;
        let h: ProvenHeight = serde_json::from_value(val)?;
        Ok(h)
    }

    /// Get the last committed L2 height.
    #[allow(dead_code)]
    pub fn get_last_committed_height(&self) -> Result<u64, Box<dyn std::error::Error>> {
        let val = self.call("citrea_getLastCommittedL2Height", serde_json::json!([]))?;
        Ok(val.as_u64().unwrap_or(0))
    }
}

// ── State diff conversion ───────────────────────────────────────

/// Convert an RPC `stateDiff` (hex-keyed JSON map) into the same
/// `Vec<(Vec<u8>, Option<Vec<u8>>)>` format used by the batch proof decoder.
///
/// This lets us feed RPC-sourced state diffs straight into `map_state_diff()`
/// and `jmt::summarize_diff()`.
pub fn state_diff_from_rpc(
    map: &serde_json::Map<String, Value>,
) -> Vec<(Vec<u8>, Option<Vec<u8>>)> {
    let mut entries = Vec::with_capacity(map.len());
    for (key_hex, val_json) in map {
        let key_hex = key_hex.strip_prefix("0x").unwrap_or(key_hex);
        let Ok(key_bytes) = hex::decode(key_hex) else {
            continue;
        };
        let value = match val_json {
            Value::Null => None,
            Value::String(s) => {
                let s = s.strip_prefix("0x").unwrap_or(s);
                hex::decode(s).ok()
            }
            _ => None,
        };
        entries.push((key_bytes, value));
    }
    entries
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_diff_from_rpc_basic() {
        let mut map = serde_json::Map::new();
        map.insert(
            "0x452f482f0000000000000000".into(),
            Value::String("0xabcdef".into()),
        );
        map.insert(
            "0x452f732f1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef".into(),
            Value::String("0x01".into()),
        );
        map.insert(
            "0xdead".into(),
            Value::Null,
        );

        let entries = state_diff_from_rpc(&map);
        assert_eq!(entries.len(), 3);

        // Find the header entry
        let header = entries
            .iter()
            .find(|(k, _)| k.starts_with(&[0x45, 0x2f, 0x48, 0x2f]))
            .unwrap();
        assert!(header.1.is_some());
        assert_eq!(header.1.as_ref().unwrap(), &[0xab, 0xcd, 0xef]);

        // Find the deleted entry
        let deleted = entries
            .iter()
            .find(|(k, _)| k == &[0xde, 0xad])
            .unwrap();
        assert!(deleted.1.is_none());
    }

    #[test]
    fn state_diff_from_rpc_no_prefix() {
        let mut map = serde_json::Map::new();
        map.insert(
            "aabb".into(),
            Value::String("ccdd".into()),
        );
        let entries = state_diff_from_rpc(&map);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].0, vec![0xaa, 0xbb]);
        assert_eq!(entries[0].1.as_ref().unwrap(), &[0xcc, 0xdd]);
    }
}
