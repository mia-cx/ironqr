# L1 Artifact and Cache Boundary

Artifact metadata is explicit and separate from mutable runtime cache:

```ts
interface NormalizedFrameArtifact {
  readonly image: SimpleImageData;
  readonly coordinateConvention: "pixel-centers-at-integers";
  readonly alphaCompositePolicy: "views-composite-on-white";
  readonly normalizedPixelFormat: "rgba-unorm8";
}
```

The metadata records pixel format, coordinate policy, and alpha policy so downstream geometry has no ambiguity.

This is L1 in the scanner artifact cache:

```text
L1 normalized frame
```

Bump the L1 cache version only when the meaning of normalized pixels changes, such as:

- different `ImageData` → `SimpleImageData` conversion semantics,
- different Float16/HDR handling,
- different alpha-composite policy,
- different decoded-frame validation semantics,
- different coordinate convention,
- different RGBA layout.

Media decode policy changes bump L1 only when the resulting `SimpleImageData` bytes or metadata semantics change.
