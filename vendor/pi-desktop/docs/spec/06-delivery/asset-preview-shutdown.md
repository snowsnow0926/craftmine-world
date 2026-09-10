# Asset preview shutdown ordering

After saving the current world, Main closes asset preview admission, cancels its
owned work and awaits confirmed worker exit before disposing the plugin body
resolver or host services. The worker termination deadline remains bounded.
An unconfirmed stop is logged and included in the headless shutdown failure
record; it cannot be reported as a clean shutdown. Other service cleanup still
runs after an asset preview shutdown failure.

`tests/player-product/asset-preview-shutdown.test.mjs` executes this actual Main
sequence slice with pending and rejected preview shutdown. Worker and host
semantics are separately verified by the real worker exit-order regression.
