# Taproot Reader — Moved

The Rust protocol crates that previously lived here have been extracted to their own repository:

**[`BINST-protocol`](https://github.com/Bitcoin-Institutions/BINST-protocol)**

This includes:
- `binst-inscription` — Parse `binst` metaprotocol Ordinals inscriptions
- `binst-decoder` — L2 state diff mapping + Taproot vault policies
- `citrea-decoder` — Citrea DA inscription decoding
- `citrea-scanner` CLI

The documentation files (`BITCOIN-IDENTITY.md`, `DECODING.md`, `conceptual.md`) and
JSON schema (`schema/`) also moved to `binst-protocol`, where they are maintained.

The three docs in this directory are historical copies kept for reference. They are
not updated and may cite paths that no longer exist here.
