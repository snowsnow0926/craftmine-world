## Verification status and method correction

The source-revision10 managed check compiled, but produced no runtime frames or confirmed snapshot. It did not return usable motor-probe results. Thus no successful native walk is claimed for that attempt; its original source and failed managed receipt are retained in source history.

The startup probe implementation has been replaced with bounded read-only PhysicsDirectSpaceState3D queries. It samples actual support at <=0.18m spacing, rejects support gaps/grades over40degrees or adjacent height changes over0.12m, and sweeps a full0.3m-radius/1.8m-height capsule forwards AND backwards. Its centre is0.94m above support (4cm ground clearance, avoiding treating intended ground contact as a wall). It also verifies eight guard-ray hits and unchanged real player pose, inventory and active camera. It does not insert temporary controllers, manually advance physics motors, move the player, change progress, disable collision or claim real-time walking. This supersedes the last paragraph of bridge_connection_repair.md.

A passing result is geometric/native-collision evidence only. The host's frozen build/check assertions remain unchanged. Actual current-player WASD traversal and arrow-key look still require a live-input run after host-controlled adoption.
