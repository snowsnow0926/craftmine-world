# Windows workspace dependency build

The desktop `build:deps` script must select and build its five workspace dependencies
when invoked through the Windows package-script shell. Quote the existing pnpm
filter with double quotes; single quotes are not shell quoting on that platform
and can silently select zero projects. Keep the same dependency-only filter and
build command on other platforms. No dependency installation or runtime behavior
is added to the script. The normal desktop type check requires these package outputs.
