# Target feedback uses the existing player operation journal

Status: Accepted

The first player parameter editor needs to survive uncertain transport and
restart without duplicating source writes or check jobs. It also needs a narrow
renderer interface that cannot supply host task identity or arbitrary files.

Main owns a finite three-channel adapter. The renderer supplies a validated
`sourceBinding` observation and declared parameter values. Main maps that
observation to the private service contract, which still derives current source
authority and uses the existing source transaction. The existing workbench
journal owns player intent and initial receipts; the private service owns source
write and check-job recovery. Candidate adoption retains its existing owner.

An operation that received a queued receipt remains recoverable through a
separate status query. Only exact errors known to occur before a source write
may finish as a rejection. Lost responses and arbitrary exceptions cannot
silently unlock the form for a new operation. No additional browser storage,
arbitrary property RPC, runtime write API, or model request is introduced.

This deliberately supports one reviewed instance configuration. More parameters
need their own source semantics, compatibility, progress, and runtime checks;
the presence of a generic game engine is not evidence of such support.
