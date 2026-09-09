# Dispatch E: protect the envelope key and grant selected paths

Status: ready for integration, 2026-09-09.

Keep the established AES-GCM secret payload format so old provider/OAuth fixtures remain decryptable. Protect the envelope key with current-user DPAPI; changing every secret's format would add multi-file migration failure points. Verify the DPAPI round trip before an atomic key replacement. Do not retain an extra plaintext backup, invent a new key when ciphertext already exists, or downgrade after a protector failure. Unavailable credentials must not prevent offline world access.

Separate portable domain backups from local offline upgrade snapshots. Rust owns domain contents, trust and atomic restore. Electron owns user-selected paths and expiring content-bound grants. The installer snapshot merely preserves closed files before installation; it is not a second live database writer or an automatic restore mechanism.

The native product remains unsigned and manually distributed until final release acceptance. Dedicated identity and retained licensing do not by themselves demonstrate a working installation on a clean machine. Build and install evidence must remain separate.
