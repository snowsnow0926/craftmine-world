# Preserve target worlds when reusing aircraft behavior

Date: 2026-09-13
Status: Accepted for the authorized reusable content work package

The approved flight world owns its whole scene and presentation. Copying that
root into another world would replace its behavior and controller. A bare GLB
would lose driving, landing and persistence.

Package the accepted GLB and adapted simplified flight controller as an
independent scene component, using the existing immutable source package and
persistent component contracts. Keep target geometry and player controller
source intact. Publish explicit runway/airspace requirements and refuse an
inadequate stock field through actual collision preflight.

The first increment retains the on-foot player at the boarding point under an
owned movement lock while the aircraft and camera travel. Grounded return and
stop are required for normal exit. The saved vehicle state records this
abstraction explicitly. Native paused restore continues validating the original
player collision profile; aircraft presentation resumes afterward. No native
guard, world bound, or collision policy is disabled to accept vehicle progress.

A future vehicle-aware player/controller profile could support physically
moving passengers and exiting at arbitrary safe terrain, but must be a separately
specified native interface with real collision evidence. This component does
not imply those capabilities.
