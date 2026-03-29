//! citrea-scanner — Scan Bitcoin testnet4 blocks for Citrea DA inscriptions.
//!
//! Connects to a local Bitcoin Core testnet4 node, iterates over blocks,
//! identifies Citrea reveal transactions by their wtxid prefix, and decodes
//! the tapscript inscriptions.
//!
//! # Usage
//!
//! ```bash
//! # Scan a specific block
//! citrea-scanner --block 127600
//!
//! # Scan a range of blocks
//! citrea-scanner --from 127590 --to 127610
//!
//! # Scan the latest N blocks
//! citrea-scanner --latest 100
//! ```

use bitcoincore_rpc::{Auth, Client, RpcApi};
use citrea_decoder::{
    extract_tapscript, has_citrea_prefix, parse_tapscript, DataOnDa, REVEAL_TX_PREFIX,
};
use clap::Parser;

/// Scan Bitcoin testnet4 for Citrea DA inscriptions.
#[derive(Parser, Debug)]
#[command(name = "citrea-scanner", about = "Decode Citrea inscriptions from Bitcoin testnet4")]
struct Args {
    /// Scan a specific block height.
    #[arg(long)]
    block: Option<u64>,

    /// Start of block range to scan.
    #[arg(long)]
    from: Option<u64>,

    /// End of block range to scan (inclusive).
    #[arg(long)]
    to: Option<u64>,

    /// Scan the latest N blocks from chain tip.
    #[arg(long)]
    latest: Option<u64>,

    /// Bitcoin Core RPC URL.
    #[arg(long, default_value = "http://127.0.0.1:48332")]
    rpc_url: String,

    /// RPC cookie file path (auto-detected if not specified).
    #[arg(long)]
    cookie: Option<String>,

    /// RPC username (alternative to cookie auth).
    #[arg(long)]
    rpc_user: Option<String>,

    /// RPC password (alternative to cookie auth).
    #[arg(long)]
    rpc_pass: Option<String>,

    /// Output format: "text" or "json".
    #[arg(long, default_value = "text")]
    format: String,

    /// Only show transactions of this type (0-4).
    #[arg(long)]
    kind: Option<u16>,
}

fn get_auth(args: &Args) -> Auth {
    if let (Some(user), Some(pass)) = (&args.rpc_user, &args.rpc_pass) {
        Auth::UserPass(user.clone(), pass.clone())
    } else if let Some(cookie) = &args.cookie {
        Auth::CookieFile(cookie.into())
    } else {
        // Default testnet4 cookie location on macOS
        let home = std::env::var("HOME").unwrap_or_default();
        let cookie_path = format!("{home}/.bitcoin/testnet4/.cookie");
        if std::path::Path::new(&cookie_path).exists() {
            Auth::CookieFile(cookie_path.into())
        } else {
            eprintln!("Warning: No cookie file found at {cookie_path}, trying without auth");
            Auth::None
        }
    }
}

/// Compute the wtxid of a raw transaction.
/// wtxid = double-SHA256 of the serialized tx including witness.
fn compute_wtxid(raw_tx: &[u8]) -> [u8; 32] {
    use bitcoin::hashes::{sha256d, Hash};
    let hash = sha256d::Hash::hash(raw_tx);
    let mut result = [0u8; 32];
    result.copy_from_slice(hash.as_ref());
    result
}

fn scan_block(client: &Client, height: u64, args: &Args) -> Result<u64, Box<dyn std::error::Error>> {
    let block_hash = client.get_block_hash(height)?;
    let block = client.get_block(&block_hash)?;

    let mut found = 0u64;

    for (tx_idx, tx) in block.txdata.iter().enumerate() {
        if tx_idx == 0 {
            continue; // skip coinbase
        }

        // Serialize tx to compute wtxid
        let raw = bitcoin::consensus::serialize(tx);
        let wtxid = compute_wtxid(&raw);

        if !has_citrea_prefix(&wtxid, REVEAL_TX_PREFIX) {
            continue;
        }

        // Extract witness from first input
        let witness: Vec<Vec<u8>> = tx.input[0].witness.to_vec();

        let Some(tapscript_bytes) = extract_tapscript(&witness) else {
            continue;
        };

        let inscription = match parse_tapscript(tapscript_bytes) {
            Ok(i) => i,
            Err(e) => {
                eprintln!(
                    "  Block {height} tx[{tx_idx}]: parse error: {e} (wtxid {})",
                    hex::encode(wtxid)
                );
                continue;
            }
        };

        // Filter by kind if requested
        if let Some(filter_kind) = args.kind {
            if (inscription.kind as u16) != filter_kind {
                continue;
            }
        }

        found += 1;

        if args.format == "json" {
            print_json(height, tx_idx, tx, &wtxid, &inscription);
        } else {
            print_text(height, tx_idx, tx, &wtxid, &inscription);
        }
    }

    Ok(found)
}

fn print_text(
    height: u64,
    tx_idx: usize,
    tx: &bitcoin::Transaction,
    wtxid: &[u8; 32],
    inscription: &citrea_decoder::ParsedInscription,
) {
    println!(
        "Block {height} tx[{tx_idx}] — {} (wtxid: {}...)",
        inscription.kind,
        hex::encode(&wtxid[..4]),
    );
    println!("  txid:    {}", tx.compute_txid());
    println!("  pubkey:  {}", hex::encode(inscription.tapscript_pubkey));
    println!("  body:    {} bytes", inscription.body.len());

    match inscription.decode_body() {
        Ok(DataOnDa::SequencerCommitment(sc)) => {
            println!("  ── SequencerCommitment ──");
            println!("  index:         {}", sc.index);
            println!("  l2_end_block:  {}", sc.l2_end_block_number);
            println!("  merkle_root:   {}", hex::encode(sc.merkle_root));
        }
        Ok(DataOnDa::Complete(proof)) => {
            println!("  ── Complete Batch Proof ──");
            println!("  proof size:    {} bytes (compressed)", proof.len());
        }
        Ok(DataOnDa::Aggregate(txids, wtxids)) => {
            println!("  ── Aggregate ──");
            println!("  chunk txids:   {}", txids.len());
            println!("  chunk wtxids:  {}", wtxids.len());
        }
        Ok(DataOnDa::Chunk(data)) => {
            println!("  ── Chunk ──");
            println!("  chunk size:    {} bytes", data.len());
        }
        Ok(DataOnDa::BatchProofMethodId(m)) => {
            println!("  ── BatchProofMethodId ──");
            println!("  method_id:     {} bytes", m.method_id.len());
            println!("  signatures:    {}", m.signatures.len());
        }
        Err(e) => {
            println!("  ── Borsh decode error: {e} ──");
            println!("  raw body hex:  {}", hex::encode(&inscription.body));
        }
    }
    println!();
}

fn print_json(
    height: u64,
    tx_idx: usize,
    tx: &bitcoin::Transaction,
    wtxid: &[u8; 32],
    inscription: &citrea_decoder::ParsedInscription,
) {
    let mut obj = serde_json::json!({
        "block": height,
        "tx_index": tx_idx,
        "txid": tx.compute_txid().to_string(),
        "wtxid": hex::encode(wtxid),
        "kind": format!("{}", inscription.kind),
        "pubkey": hex::encode(inscription.tapscript_pubkey),
        "body_size": inscription.body.len(),
    });

    match inscription.decode_body() {
        Ok(DataOnDa::SequencerCommitment(sc)) => {
            obj["sequencer_commitment"] = serde_json::json!({
                "index": sc.index,
                "l2_end_block_number": sc.l2_end_block_number,
                "merkle_root": hex::encode(sc.merkle_root),
            });
        }
        Ok(DataOnDa::Complete(proof)) => {
            obj["complete_proof"] = serde_json::json!({
                "compressed_size": proof.len(),
            });
        }
        Ok(DataOnDa::Aggregate(txids, _wtxids)) => {
            obj["aggregate"] = serde_json::json!({
                "chunk_count": txids.len(),
                "chunk_txids": txids.iter().map(hex::encode).collect::<Vec<_>>(),
            });
        }
        _ => {}
    }

    println!("{}", serde_json::to_string_pretty(&obj).unwrap());
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    let auth = get_auth(&args);
    let client = Client::new(&args.rpc_url, auth)?;

    // Verify connection
    let info = client.get_blockchain_info()?;
    eprintln!(
        "Connected to {} (block {})",
        info.chain, info.blocks
    );

    // Determine block range to scan
    let (from, to) = if let Some(block) = args.block {
        (block, block)
    } else if let Some(latest) = args.latest {
        let tip = info.blocks as u64;
        (tip.saturating_sub(latest - 1), tip)
    } else {
        let from = args.from.unwrap_or(info.blocks as u64);
        let to = args.to.unwrap_or(from);
        (from, to)
    };

    eprintln!("Scanning blocks {from}..={to} ({} blocks)", to - from + 1);
    eprintln!();

    let mut total_found = 0u64;
    for height in from..=to {
        match scan_block(&client, height, &args) {
            Ok(n) => total_found += n,
            Err(e) => eprintln!("Error scanning block {height}: {e}"),
        }
    }

    eprintln!("Found {total_found} Citrea inscription(s)");
    Ok(())
}
