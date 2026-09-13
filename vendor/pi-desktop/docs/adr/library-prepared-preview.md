# Keep one frame before the sheet covers the world

The real offscreen PI publication succeeded but reported `previewStatus: unavailable`: opening the asset sheet had already hidden the world view, so guarded capture correctly refused it. Reattaching a hidden view would violate capture ownership and interfere with the current surface.

We retain a single bounded native derivative before the sheet opens. Binding includes the formal source manifest and runtime instance; the cache cannot cross source changes, candidate scope or world reopen. Formal artifact identity is used instead of progress hash because the explicit saved-progress checkbox invokes a legitimate runtime checkpoint before publication. Labels describe a source-world view, not an instantaneous save frame. No renderer-supplied image or filesystem destination enters the trusted capture path.
