# Copy service and user button

New modules are godot-world-copy-service.ts and components/craftmine/CopyWorldButton.tsx; existing navigation/index files are untouched.

createGodotWorldCopyService({domain,selection,checkpoint,open,start}) exposes copy({worldId,operationId,title?}), status(same request), and the busy getter for profile-switch guards. targetWorldId is copy- plus the first 40 hexadecimal SHA256 characters of worldId + "|" + operationId. Unknown payload keys, snapshots, paths and supplied contexts are rejected.

checkpoint must return {status:"persisted",receipt:{format:"craftmine.godot-progress-receipt/1",worldId,buildId,revision}} from the actual frozen source. The service rereads core and verifies revision/build, then compares the new copy to that entire saved snapshot with only outer/body world identities changed. It never supplies snapshot to core copy.

copyStatus({worldId:targetWorldId,sourceWorldId:originalSelection}) is a private read-only core RPC. It verifies the original selected source through the existing copy-id digest and returns originalSourceWorldId separately from sourceBuildOwnerWorldId. Supplying an incorrect original source rejects. Omitted sourceWorldId yields originalSourceWorldId:null instead of guessing an identity unavailable in old rows. This supports pending copy-of-copy provenance without schema changes.

Replay reuses the durable copy origin after lost responses, service restart and independent-build failure. An existing non-copy target cannot be adopted. Once the target exists, retries preserve its own current progress and never copy the source again. Content migration/source repair/fixed identity preparation precede actual restore-service start; source selection is checked again before switching. start must complete independent check/launch/application, after which the service verifies a target-owned formal descriptor and unchanged full progress. Only then is status ready returned.

Root must route world.copy to this service, wire checkpoint/open/start to the real host lifecycle, mount CopyWorldButton, and add the private copyStatus route. The component receives bridge, worldId, optional title/disabled/onCopied; it displays working/error, uses the same operationId for retries while mounted, and does not mark a pending response successful. It is not a separate world store.

Validation: 5 pure service fixtures cover normal/lost-response origin replay, retry after independent rebuild failure, durable-save failure, and foreign origin/payload rejection. The new button bundles successfully; service strict TypeScript check passes. A real core archive regression verifies copyStatus distinguishes original selected source from immutable build owner and rejects wrong origin. Actual UI/client gameplay is root-owned; these fixtures do not claim it.
