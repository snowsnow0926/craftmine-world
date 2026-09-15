# License texts

The project grant and exceptions are defined in [../LICENSING.md](../LICENSING.md).
These files preserve complete license texts; a copy of a text does not extend its scope to unrelated material.

| File | Scope / source |
| --- | --- |
| [../LICENSE](../LICENSE) | GNU AGPL version 3, applied as AGPL-3.0-only to original project creation software. |
| [MIT.txt](MIT.txt) | MIT grant with the existing Craftmine contributor copyright line, for the original runtime scopes listed in LICENSING.md. |
| [LGPL-3.0-or-later.txt](LGPL-3.0-or-later.txt) | Complete LGPL version 3 supplement. PI Desktop's existing declaration permits later versions. Its original license remains in `vendor/pi-desktop/LICENSE`. |
| [GPL-3.0-or-later.txt](GPL-3.0-or-later.txt) | Complete GPL version 3 text, required with the LGPL supplement and used by the existing Blender adapter declaration. Component declarations determine whether later versions are allowed. |

GNU texts were copied byte-for-byte from the already pinned official texts in
`desktop/delivery/licensing/texts/`, after verifying their SHA-256 values against
that directory's [SOURCES.json](../desktop/delivery/licensing/texts/SOURCES.json):

| Text | Official source | SHA-256 |
| --- | --- | --- |
| AGPL-3.0 | https://www.gnu.org/licenses/agpl-3.0.txt | `0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0` |
| LGPL-3.0 | https://www.gnu.org/licenses/lgpl-3.0.txt | `e3a994d82e644b03a792a930f574002658412f62407f5fee083f2555c5f23118` |
| GPL-3.0 | https://www.gnu.org/licenses/gpl-3.0.txt | `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986` |

The MIT text uses the standard permission and warranty terms and the copyright
line already present in the project's original MIT components. Its runtime copy
is [CRAFTMINE-RUNTIME-MIT.txt](../desktop/godot/licenses/CRAFTMINE-RUNTIME-MIT.txt).

Other dependencies keep their full texts and attribution at the locations in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). Do not replace a dependency's
copyright notice with the generic project notice.
