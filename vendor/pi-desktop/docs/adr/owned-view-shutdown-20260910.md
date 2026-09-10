# Await actual destruction of owned views

Date: 2026-09-10. Status: accepted for the next integration candidate.

The previous void close calls allowed Main to release quit while renderers were
still alive. A synchronous browser close exception could also skip other owners.
Use one retirement helper and a shared final-disposal Promise per owner, with
bounded rejection and references retained through actual destruction. Separate
reusable browser guest retirement from final application disposal: plugin reload
must remain usable. Keep prior failures observable even after late destruction.

Main isolates failures after the existing world-save gate. This changes ownership
completion semantics, not save policy, navigation permissions or input behavior.
It adds no renderer RPC. Controlled failure tests and actual offscreen Electron
close events validate the contract. Full-client/package regression remains an
integration responsibility; no causal claim is made about the IOCP failure.
