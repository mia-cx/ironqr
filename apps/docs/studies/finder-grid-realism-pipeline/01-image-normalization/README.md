# 01 — Image Normalization

Image normalization adopts a decoded RGBA frame into the scanner's canonical pixel artifact.

This stage starts **after** media decode. It should not care whether the pixels came from JPEG, PNG, WebP, canvas, bitmap, video, or native/WASM decode.

This stage should answer:

```text
What exact decoded pixels are later stages allowed to read?
What coordinate system do those pixels live in?
What validation happened before expensive scanner work starts?
```

## Input

Input is a decoded image frame from stage 00:

```ts
interface DecodedImageFrame {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray; // row-major RGBA
}
```

Current code still has a combined public entry point:

```ts
normalizeImageInput(input)
```

That function performs media decode when needed and then calls normalization. In this spec, those responsibilities are split:

```text
00 media decode → decoded RGBA frame
01 image normalization → NormalizedImage
```

For already decoded data, the current code uses:

```ts
createNormalizedImage(imageData)
```

## Target output artifact

The target artifact is pure decoded-pixel data:

```ts
interface NormalizedImage {
  readonly width: number;
  readonly height: number;
  readonly rgbaPixels: Uint8ClampedArray;
}
```

Meaning:

| Field | Meaning |
| --- | --- |
| `width` | Image width in pixels. |
| `height` | Image height in pixels. |
| `rgbaPixels` | Flat RGBA pixel buffer, 4 bytes per pixel. |

Current code still attaches `derivedViews` to `NormalizedImage` as runtime memoization. This spec treats that as an implementation detail to remove or move into `ViewBank` / `ScanContext`. It is not part of the L1 artifact contract.

## RGBA layout

The RGBA layout is row-major:

```text
pixel 0: R, G, B, A
pixel 1: R, G, B, A
pixel 2: R, G, B, A
...
```

For pixel `(x, y)`, the base offset is:

```text
index = y × width + x
base = index × 4
r = rgbaPixels[base + 0]
g = rgbaPixels[base + 1]
b = rgbaPixels[base + 2]
a = rgbaPixels[base + 3]
```

`width` is the row length. When `x` reaches `width`, the next pixel is the start of the next row.

## Shared RGBA pixel reader

The spec should expose a safe coordinate helper for non-hot code, tests, and documentation. This helper encodes the row-major RGBA layout in one place.

```ts
interface RgbaPixel {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const isPixelInBounds = (image: NormalizedImage, x: number, y: number): boolean =>
  Number.isInteger(x) &&
  Number.isInteger(y) &&
  x >= 0 &&
  y >= 0 &&
  x < image.width &&
  y < image.height;

const rgbaPixelOffset = (image: NormalizedImage, x: number, y: number): number => {
  if (!isPixelInBounds(image, x, y)) {
    throw new RangeError(
      `Pixel coordinate (${x}, ${y}) is outside ${image.width}x${image.height}.`,
    );
  }
  return (y * image.width + x) * 4;
};

const readRgbaPixel = (image: NormalizedImage, x: number, y: number): RgbaPixel => {
  const base = rgbaPixelOffset(image, x, y);
  return {
    r: image.rgbaPixels[base + 0] ?? 0,
    g: image.rgbaPixels[base + 1] ?? 0,
    b: image.rgbaPixels[base + 2] ?? 0,
    a: image.rgbaPixels[base + 3] ?? 0,
  };
};
```

Policy:

- `readRgbaPixel(...)` throws on invalid integer coordinates.
- Consumers decide whether to catch that error, pre-check with `isPixelInBounds(...)`, or avoid calling the helper.
- Hot full-frame loops may use direct offset math after validating image dimensions once.
- Subpixel geometry must not use this integer pixel reader directly; it should use interpolation/sampling helpers.

## Coordinate convention

The scanner's image-space coordinate convention is:

```text
integer pixel coordinates refer to pixel centers
pixel (x=10, y=20) has center at image point (10, 20)
continuous image points may use fractional coordinates
```

So these are valid continuous image-space points:

```text
(10, 20)
(10.5, 20)
(10.25, 20.75)
```

This matters because later finder geometry should store subpixel module centers and module edges. Geometry fitting must not round these points. Rounding or interpolation only belongs at the image-sampling boundary.

## Validation

Validation happens at the decoded-frame trust boundary.

Current limits:

```ts
MAX_IMAGE_DIMENSION = 8192;
MAX_IMAGE_PIXELS = 35_389_440; // 8192 × 4320
```

The scanner rejects:

- non-safe-integer dimensions,
- zero or negative dimensions,
- width/height above max side length,
- total area above max pixel count,
- decoded frame buffers that are not `Uint8ClampedArray`,
- RGBA buffers with wrong length.

This means downstream stages may assume:

```text
width > 0
height > 0
rgbaPixels.length = width × height × 4
```

`height` is kept as explicit metadata even though it is derivable from buffer length and width. The explicit invariant is:

```text
rgbaPixels.length === width × height × 4
```

## Alpha handling

The normalized image preserves the RGBA pixels as provided by stage 00.

Scalar-view construction later composites RGB over white before producing grayscale/RGB/OKLab scalar values:

```text
alpha = A / 255
background = 1 - alpha
channel = (channel / 255) × alpha + background
```

So transparent pixels behave as if shown on white.

This is important for QR artwork with transparent backgrounds.

## Runtime state boundary

Derived scalar/binary/OKLab views are runtime memoization, not L1 image data.

Target ownership:

```text
NormalizedImage
  width, height, rgbaPixels only

ViewBank / ScanContext
  scalar view cache
  binary plane cache
  binary view cache
  OKLab plane cache
```

For math-based realism, this stage should remain simple and stable. If metadata is needed, it should be explicit artifact metadata, not mutable runtime cache:

```ts
interface NormalizedFrameArtifact {
  readonly width: number;
  readonly height: number;
  readonly rgbaPixels: Uint8ClampedArray;
  readonly coordinateConvention: 'pixel-centers-at-integers';
  readonly alphaCompositePolicy: 'views-composite-on-white';
}
```

The key addition is precise metadata about coordinate and alpha policy so downstream geometry has no ambiguity.

## Empirical questions

This stage itself is not a QR signal, but it affects every later signal. Studies should track:

| Question | Why |
| --- | --- |
| Do transparent assets behave differently after white compositing? | QR artwork may rely on transparency. |
| Do very large images dominate materialization time? | Cache and budget planning. |
| Are decode/finder failures correlated with source dimensions? | Very small modules can become unresolvable. |
| Is the 8192×4320 area budget safe across browser, Node, native, and WASM backends? | Product input guarantee. |

## Cache boundary

This is L1 in the scanner artifact cache:

```text
L1 normalized frame
```

Bump the L1 cache version only when the meaning of normalized pixels changes, such as:

- different alpha-composite policy,
- different decoded-frame validation semantics,
- different coordinate convention,
- different RGBA layout.

Media decode policy changes belong to stage 00 and should not automatically bump L1 unless the resulting normalized pixels change.
