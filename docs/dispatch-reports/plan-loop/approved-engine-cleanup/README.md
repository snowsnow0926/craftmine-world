# Approved old engine-copy cleanup checkpoint

The user explicitly approved the existing 64-file proposal. Execution removed
only those individual EXE copies after checking every candidate path, file hash,
the retained release engine, ordinary ancestors and absence of running copies.
No recursive deletion or directory move was performed.

The independent post-cleanup audit found exactly 64 approved files absent,
7,051 retained files with identical bytes and SHA-256, and an unchanged set of
3,157 directories. There were no additional changes or missing files. The
retained release engine also matched. The original proposal and full audit
inputs remained unchanged.

Free-space readings immediately before and after execution increased by
7,769,042,944 bytes. Deleted logical file lengths total 11,574,968,832 bytes;
these are different measurements because the old files were NTFS-compressed.

CHECKPOINT.json pins the exact proposal/result copies and the full original
read-only retained-file verification under test-results. Historical compression
reports are unchanged: they describe the earlier byte-preserving operation.
This later authorized removal is recorded separately rather than rewriting
those original facts. It does not authorize deletion of any other old profile.
