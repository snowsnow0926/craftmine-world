# Sequence-door player language and identity resolution

The earlier requirement freezer recognized only `依次触碰<technical-id>、<technical-id>后打开<technical-id>`. Ordinary labels, colors or the selected door could leave a supported sequence task unverified solely because of wording.

`resolveCreationSequenceIntent` recognizes a finite set of whole-sentence sequence forms using touch/trigger/press verbs. It resolves marker references against exact IDs, exact captured labels and the existing fixed color vocabulary; door references use exact IDs, that vocabulary or explicit selected-door phrases. The original player text still owns the request hash. Resolution changes neither the selected world nor source or object properties.

All plausible matches participate in ambiguity detection. Duplicate labels/colors, repeated IDs, missing objects, wrong selected kinds, malformed samples and more than eight sequence steps yield unknown. Negation, unordered actions and additional unrecognized requests are not silently trimmed. The exact preservation suffix is accepted under the existing requirement freezer's declaration-preservation scope. This is not a general natural-language interpreter or a guarantee that arbitrary imported scene objects are fully covered.

The result enters the existing immutable requirement path with real entity IDs and captured geometry, including passage verification. It does not bypass core checks or let the model set success criteria. Existing technical-ID requests remain compatible. New objects absent from the original capture cannot be resolved into frozen sequence targets in the same request; that case stays unverified rather than guessing future IDs.

Resolved entities retain captured colors. Marker labels, when present, are frozen as the optional finite `declaredLabel` requirement and matched against the observed source declaration's `parameters.label` in both host and core. This prevents changing label/color meanings after resolving the player's references. It is explicitly declaration evidence; it does not establish the actual rendered Label3D text or general UI correctness. Old stored requirements without this field preserve their former checks and hashes.

Tests cover ordinary labels/selected doors, legacy IDs, ambiguous and malformed data, repeated steps, negation and suffixes, plus the actual frozen requirement and original text hash. Host and core reject changed/missing label declarations; the core test also verifies legacy omission behavior and invalid kinds/length/types. Real model acceptance is separate from these parser tests.
