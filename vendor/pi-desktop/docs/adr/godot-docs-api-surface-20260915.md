# Expose the already bundled Godot API reference modes

The A6 navigation task queried NavigationServer3D and NavigationAgent3D through
the curated manual search. The shipped package already contained a validated
6,284,092-byte ClassDB corpus and the `world-tools` API query implementation,
but the public tool schema advertised only `info/search/read` and omitted all
class/member parameters. Normal PI argument validation rejected class queries.

Publish the existing `api-info/api-class/api-search` modes and parameters in the
manifest, and explain the distinct reference sources in info/search responses.
Retain digest mode compatibility and all existing metadata integrity, pagination,
unknown-domain and version guards. This repairs reachability without downloading
new documentation, adding another engine, broadening permissions or changing
the application state. Semantic navigation guidance remains separate from
reflection metadata and must not be fabricated from method presence.
