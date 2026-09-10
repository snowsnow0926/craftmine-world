# Local core build used by finite parameter acceptance

The offline, single-job release build completed with exit 0 in 2m 36s. The raw
successful build log retains compiler warnings. `build-evidence.json` records
the actual compiler, command, tracked Cargo/crate source hashes and both binary
hashes. Those Rust sources remain unchanged from the recorded source commit.

An earlier parallel attempt failed inside rustc 1.96.1 LLVM while compiling
`aho-corasick`, with `Do not know how to promote this operator!`. Retrying with
`--jobs 1` succeeded without source or toolchain changes. The first failure's
full raw log was not saved, so this directory does not present a reconstructed
log as original evidence.

These binaries support the actual development-client and candidate-chain
records. They do not establish a new Windows package, installer lifecycle,
external-model acceptance or bit-for-bit reproducibility.
