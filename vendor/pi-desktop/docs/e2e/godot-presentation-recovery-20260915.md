# Automatic adoption and world presentation recovery

Run the actual complete world-view fixture with an independent headless profile, disabled GPU and disabled Pointer Lock. Invoke existing DOM callbacks by page script, without synthetic mouse or keyboard input.

1. Refuse a surface request with the exact host candidate-busy error. Confirm that failure is visible and no success is inferred while the gate remains active.
2. Complete automatic adoption, release the gate and require a new successful presentation reply. The queue's own busy error disappears. The unchanged ordinary show-world helper must now pass its strict error check and execute the existing tab callback.
3. Confirm the applied build, instance and player progress remain unchanged, without a candidate close/apply call from recovery.
4. Insert a real save error while waiting. Neither repeated busy responses nor eventual surface success may erase it. An unknown presentation error is also visible and not retried.
5. Open a manual preview while a retry is pending. It remains under normal preview controls; only the player's existing return action closes it.
6. Verify world/page changes, close, disposal and stale physical replies cannot resurrect old intents. Many updates keep one physical request and one timer. Non-affirmative host replies never count as success.

Commands: node --test tests/godot-presentation-queue.test.mjs tests/godot-autosave-candidate.test.mjs tests/godot-panel-recovery.test.mjs tests/legacy-snapshot-equality.test.mjs; node tests/godot-presentation-recovery-headless.mjs; node tests/fb02-creation-result-headless.mjs.

These finite-host checks validate UI scheduling, error ownership and unchanged ordinary actions. They do not claim native GPU rendering, persistence or model generation acceptance. The original preview26 native record independently established successful adoption, visible tree, movement and save despite the stale banner; the packaged fix must be verified separately by the coordinating native player test.
