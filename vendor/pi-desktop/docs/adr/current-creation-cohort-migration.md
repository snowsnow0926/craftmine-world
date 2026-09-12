# Recognize current observer cohorts before legacy migration

Date: 2026-09-12. Status: accepted.

An ordinary player prompt in a sealed v2 world failed with
`CREATION_MIGRATION_NEEDED` before any model request. The source migration service
accepted only legacy adapter bytes and therefore treated a newly created current
world as an unsupported old customization. Real materialized v1 and v2 sources
reproduced the refusal.

Reuse the observer pin classifier to recognize complete current formal cohorts.
After validating active capture/formal identity and project selectors, return
no migration. Do not rewrite or downgrade them. An ordinary unadopted draft does
not require a migration and remains repairable through normal source tools.

The v1 observer gate retains its eight-file contract; v2 retains twelve. This
does not replace v1's separate ten-file physical-controller proof. Missing,
mixed, duplicate or changed protected files cannot take this no-op route. The
existing legacy migration write/receipt/draft checks remain unchanged. Actual
ordinary entry must be revalidated in a new sealed package using the preserved
world and session; fixture tests alone do not prove model execution.
