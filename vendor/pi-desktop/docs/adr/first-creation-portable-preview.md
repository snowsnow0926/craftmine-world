# First creation portable preview

Status: accepted for the preview22 local delivery lane, 2026-09-13.

The existing folder build already seals and verifies application, native runtime,
source and license bytes. Manually copying a launcher and inventing a ZIP receipt
afterwards can lose version identity, profile separation or archive verification.

Add a separate repository export command that consumes a verified sealed release
and the same clean commit. It never rebuilds, changes or relabels release bytes.
It reserves a fresh delivery directory and ZIP, generates a relative launcher
with its own preview profile, pins the archive tool and compares the extracted
portable tree with the source tree. It retains byte evidence and extraction.

This is a local build interface, not a renderer capability or updater. It does
not start the application, install it, create an update feed, sign it or publish
anything remotely. External clean-Windows and human acceptance remain distinct
facts. Existing NSIS verification requirements stay unchanged.
