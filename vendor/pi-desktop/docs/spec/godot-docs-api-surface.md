# Godot documentation and reflected API tool surface

The existing `godot_docs` tool publicly exposes both offline sources:

| Mode | Source and parameters |
| --- | --- |
| `info` | Coverage of the 16-topic curated manual digest and the API metadata entry points. |
| `search` | Ranked digest topics using `query`, optional `topic` and `limit` (1–20). |
| `read` | Exact digest text using `id`, character `start` and `limit` (1–16000). |
| `api-info` | Existing pinned engine ClassDB coverage, provenance and query pins. |
| `api-class` | Exact `className`, optional exact `memberName`, `kind`, `inherited`, `offset`, `limit`. |
| `api-search` | One class/member substring in `query`, optional `className`, `kind`, `inherited`, `offset`, `limit`. |

API member pages retain the existing 1–100 item bound, default 20. Continuations
use `offset` with the returned `engineVersion` and `corpusHash`; they do not use
the digest's character `start`. `kind=class` is valid only for API search.
API query identifiers retain their existing 160-character validation. Unknown
classes/members and mismatched version/hash return explicit unknown metadata;
invalid fields, modes and unpinned continuations are rejected.

The API source is the existing measured Godot 4.7.2-stable ClassDB corpus,
validated against the shipped editor binary hash and locked metadata digest.
It contains signatures/types, properties, signals, enums and constants. It is
not the full semantic API manual, does not prove Web export availability and
does not grant engine execution, sandbox permission or gameplay acceptance.
No network fetch, engine process or world binding is required on this read path.

Digest info/search now explicitly link to the reflected API modes. A zero-match
digest search reports `coverageGap.status=no-curated-match`, with engine API
support still undetermined. Generic word hits are not evidence that the queried
class/member is documented. Existing digest text, citations, body digest,
Chinese aliases and ranking remain unchanged.
