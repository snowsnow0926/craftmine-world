# Literal per-file content differences

`content.diff` is an exact per-file operation. A validated relative filename may
contain square brackets, which are legal in the shared content path contract but
have wildcard meaning in Git pathspecs. `--` alone does not make a path literal.

After the existing path validation, `RepositoryStore::file_diff` decorates its
internal Git argument as `:(literal)<validated-path>` for both numstat and patch
queries. Both queries prohibit external diff and text conversion. The public
path, binary blob lookup, returned identity and allowed-character rules remain
unchanged. Caller-supplied magic prefixes, wildcards, drive paths and traversal
remain rejected. This applies to older content/history paths too; the narrower
managed Godot source path policy is not expanded.

Regression validation uses an actual managed Git repository. Both `a[1].gd` and
`a1.gd` change, with intentionally different line counts. The requested patch
must contain exactly one file and its own counts. A binary `image[1].png` next
to textual `image1.png` must preserve binary classification and exact old/new
sizes. Public `:(glob)`, `:(literal)`, `:(top)`, `*`, `?`, traversal and drive
forms remain rejected. Reads must leave the branch head unchanged.

The VM2 host's exact change-list membership remains useful authorization, but is
not a replacement for literal treatment at the Git boundary. This repair adds
no new source operation, runtime execution, content write or model invocation.
