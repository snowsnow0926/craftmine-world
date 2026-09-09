# Formal Windows export acceptance

Run node tests/godot-final-install-assets/windows-service.test.mjs (7 tests), and the isolated package-ui-headless.mjs with CRAFTMINE_DEPS_ROOT set. UI invokes script handlers only and guards Pointer Lock/focus.

For native acceptance, set CRAFTMINE_CORE_BIN, CRAFTMINE_BROKER_BIN, CRAFTMINE_BROKER_IDENTITY, CRAFTMINE_GODOT_CACHE_DIR and CRAFTMINE_EXPORT_FIXTURES (array of {path,bases} pointing only to ended authored client data); run node tests/godot-final-install-assets/windows-service-native.mjs. The script copies each fixture before core access, exports actual formal builds through LPAC, and runs each produced game twice headlessly in isolated profile directories. It checks original initial bytes, complete state, exact native restart, unchanged core state and operation replay. Raw failures and final evidence reside in docs/dispatch-reports/godot-final/install-assets/windows-service. No input/focus/Pointer Lock or model call is used.
