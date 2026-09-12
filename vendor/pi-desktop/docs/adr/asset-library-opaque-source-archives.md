# Accept source archives as opaque catalog files

Status: accepted for the GU6 development branch, 2026-09-12.

The existing catalog can index raw Godot source files while the source-package
installer accepts validated ZIPs. To make already audited source archives
discoverable without copying them into a second registry, add `application/zip`
to the catalog MIME allowlist and scan mapping using the existing `package`
media kind. Existing ZIP validation remains owned by the source-package service.

The catalog intentionally does not unpack or execute ZIPs. Probe and preview
return `ARCHIVE_REQUIRES_PACKAGE_CHECK`; indexing cannot establish preview,
compatibility, installation or gameplay. Arbitrary ZIP bytes may be stored as
opaque data under the ordinary import limits, but only the existing installer
can decide whether they are a supported source package. No migration, new kind,
automatic registration, new model write authority or network fetch is added.
