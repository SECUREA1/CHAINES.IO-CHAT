# House model asset

The live viewer uses this folder as the single source for the house model.

## Replace the house

1. Export the finished house as `house-frame.glb`.
2. Replace or add it at `static/models/house/house-frame.glb`.
3. Keep the floor of the model at **Y = 0** and use real-world metres.
4. Apply or freeze transforms, triangulate geometry, and embed textures in the GLB.
5. Keep the file reasonably small for mobile use.

The page tries `house-frame.glb` first. Until that file is supplied, it automatically loads `house-frame.gltf`, a lightweight structural-house fallback included in this folder.

`model.json` is the only configuration file used by the viewer. An optimized Apple `.usdz` can be added later through `iosSrc`; when it is blank, `<model-viewer>` generates USDZ automatically for iPhone Quick Look.
