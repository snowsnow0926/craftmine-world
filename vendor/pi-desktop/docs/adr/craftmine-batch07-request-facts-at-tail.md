# Request-only task facts at the tail

Status: accepted for Craftmine World, request policy version 2.

Each request previously appended changing task IDs, revisions, receipts and
budget counters to the system prompt, before all history. This made the shared
prefix end near the start of otherwise repeated requests. Long tasks also
hit a separate local cumulative budget and were incorrectly retried as provider
failures despite substantial free context capacity.

Keep stable policy at the front and append fresh host facts to the final user
or tool result in a non-mutating request copy. A tool result keeps its native
role and call ID so reasoning/tool chains remain intact. Do not persist the
snapshot in player requirements, replay summaries as requests, remove live
identity checks or discount cache tokens from the task ledger. Provider cache
warm-up and actual prefix changes remain observable limitations.

Local accounting errors are terminal before transport retry control. The player
changes task limits in the workbench and explicitly resumes preserved work.
