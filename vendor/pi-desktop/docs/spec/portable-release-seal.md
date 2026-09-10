# Same-release portable ZIP sealing

## Entry point

After a clean-source Windows build has generated its release `seal.json` and
`package-evidence.json`, run from that same checkout:

```powershell
node desktop/seal-portable.mjs --run "D:/checkout/desktop/build/releases/<release-id>/run.json"
```

The only command-line input is the existing run record. It must belong to this
checkout and live under `desktop/build/releases`. The tool never searches older
output directories or accepts a replacement source directory, output ZIP,
executable, command, or new archive pin. It reuses `run.archiveTool` and verifies
both the full 7-Zip executable and its accompanying `7z.dll` hashes. A missing
pin fails; there is no PATH fallback or download.

## Input proof

Before compression, verify all of the following:

- Current Git HEAD is clean and equals the release, build manifest, and package
  evidence commit.
- The run owner and output directory match; the current build manifest bytes
  retain the hash recorded by the run; `verifySeal` confirms original output.
- Package evidence has format `craftmine.package-evidence/2`, names this exact
  run, and agrees on source archive hash, build manifest hash, installer pair,
  signature boundary, and total bytes. An installer run requires its earlier
  verified extraction and the same archive tool identity.
- A complete strict inventory of `output/win-unpacked` equals both the prior
  package evidence files and the release seal's `win-unpacked/` entries. No file
  is excluded. Packaged source/build manifest and source ZIP hashes agree with
  the run. The application executable and ASAR must be present.

Reject symbolic links/junctions, hard-linked files, non-regular entries, Windows
aliases/ADS, traversal, duplicate case-folded paths, control characters, and
unbounded inventories. Limits are 100,000 files, 32 GiB uncompressed payload,
and 64 MiB per JSON record. This is a local filesystem integrity boundary,
not a claim of protection against an administrator concurrently replacing
filesystem objects.

## Derivative ownership and verification

Each attempt creates a fresh `portable-<UUID>/` directory beside the run record.
It never overwrites `output`, earlier delivery files, ZIPs, or derivative
directories. Once the run's ownership is established, a rejected preflight
also retains an attempt report; malformed/foreign run paths authorize no write
and produce only a structured command error.

The fixed archive operations are ZIP creation from `win-unpacked`, technical
listing, and extraction into the attempt's new `extracted/` directory. Listing
validation precedes extraction: entries must be ordinary safe paths, with
exact expected file names and sizes. Special modes, links, duplicate paths,
unknown files/directories, and missing files fail. Each subprocess has a
five-minute deadline, bounded output, and hidden Windows launch.

Hash every extracted file and compare the complete ordered inventory against
the original package evidence. Recheck ZIP hash, the source HEAD/clean state,
run, build manifest, package evidence, original release seal, and both tool
pins after extraction. A changed input cannot gain a portable seal.

The attempt retains `archive-commands.json` and `report.json`. Successful attempts
add `portable-evidence.json` and `portable-seal.json`, written exclusively. The
evidence records the ZIP bytes/hash, complete payload files/digest, exact source
and input record hashes, inherited tool identity, and successful extraction.
The seal binds those identities and the evidence file hash. Failure leaves the
owned files for diagnosis, reports `passed: false`, and does not claim success.
Disk-write failures propagate; an incomplete attempt must not be delivered.

## Deliberate limits

This is an unsigned local-preview ZIP derivative, not a second build. It does
not execute the portable application or installer, assert a clean Windows
installation test, sign artifacts, alter licensing permissions, or claim
byte-identical ZIP reproduction across runs. Prior release evidence remains
independent and unchanged. A later clean rebuild creates a new release and
requires its own portable derivative.

`portable-seal.test.mjs` uses tiny owned Git/package fixtures. The real 7-Zip
round trip is enabled only by explicit `CRAFTMINE_TEST_ARCHIVE_TOOL`,
`CRAFTMINE_TEST_ARCHIVE_SHA256`, and
`CRAFTMINE_TEST_ARCHIVE_LIBRARY_SHA256` values. Without these existing tool
pins the two tool-dependent tests are explicitly skipped. These tests do not
count as final application package or clean-machine acceptance.
