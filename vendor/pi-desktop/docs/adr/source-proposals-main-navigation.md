# Existing proposal receipts in the main conversation

The ordinary SourceReusePanel used the main navigation bridge, while its three
existing bounded package methods were admitted only by the world panel. This
caused PERMISSION_DENIED even on an empty successful direct-creation session.

The main-frame gateway now admits sourceProposals, sourceJob and
installSourceProposal using exact world/proposal/job IDs. The existing package
service verifies the selected world and projects receipts. Source installation
still consumes the host-frozen proposal, exact archive bytes and source CAS,
then performs the normal native check. Current creation/adoption/maintenance
work blocks a new proposal installation. General archive import, source text,
paths, context, execution tokens and private direct-install methods remain
unavailable on this gateway. Errors retain their diagnostic details while the
visible message explains recovery without presenting a raw permission code.
