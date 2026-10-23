# Taproot Reader — Moved

The Rust protocol crates that previously lived here have been extracted to their own repository:

**[`BINST-protocol`](https://github.com/Bitcoin-Institutions/BINST-protocol)**

This includes:
- `binst-inscription` — Parse `binst` metaprotocol Ordinals inscriptions
- `binst-decoder` — L2 state diff mapping + Taproot vault policies
- `citrea-decoder` — Citrea DA inscription decoding
- `citrea-scanner` CLI

The documentation files (`BITCOIN-IDENTITY.md`, `DECODING.md`, `conceptual.md`) and
JSON schema (`schema/`) also moved to `binst-protocol`.

This directory retains the original conceptual docs for reference.
