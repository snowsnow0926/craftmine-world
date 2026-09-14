# DeepSeek Flash alias transport

The official `deepseek-flash` model ID routes to V4.1 Flash as of the
[2026-09-10 release](https://deepseek.com/news/deepseek-v4-1-flash/). Keep this
selected model ID and the provider's local UUID on the wire. Do not substitute
a versioned alias, endpoint, model window, output allowance or image capability.

For Chat Completions on `api.deepseek.com`, or an endpoint explicitly identified
with the DeepSeek vendor key, include the exact alias in the existing V4-family
transport override. An off-only binding must still retain the transport's
reasoning capability so PI can send `thinking.type = disabled`. This does not
enable a thinking level in the UI or override the player's selected off state.

The pinned PI SDK already detects DeepSeek from its official base URL even when
the provider is a local UUID. With model reasoning enabled, alias max/off
serialization must not be described as wholly unsupported. However, generic
catalog metadata without `thinkingLevelMap.max` makes PI clamp max to high.
When the player's enabled levels contain max and no explicit catalog max mapping
exists, provide `max: "max"`; retain any existing explicit mapping.

The [official thinking API contract](https://api-docs.deepseek.com/guides/thinking_mode/)
defines thinking enabled/high as the default, requires an explicit disabled
toggle for off, maps max to max, and requires prior assistant reasoning content
on requests carrying tools. Preserve the existing DeepSeek compatibility flag
for this field. Do not broaden the alias match to unrelated model names or
unidentified proxy endpoints.
