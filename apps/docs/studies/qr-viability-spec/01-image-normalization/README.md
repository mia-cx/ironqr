# 01 — Image Normalization

Image normalization converts browser `ImageData` into IronQR's canonical `SimpleImageData` artifact.

This stage starts **after** media decode. It does not care whether the source was JPEG, PNG, WebP, HEIC, canvas, bitmap, video, or native/WASM decode. It only cares about normalizing the decoded frame into a stable 8-bit RGBA contract.

## Responsibility

Stage 01 owns:

```text
final decoded-frame width/height/area validation
final buffer type and length validation
conversion from runtime ImageData formats into canonical 8-bit RGBA
canonical coordinate convention
safe integer RGBA pixel reads
L1 normalized-frame artifact semantics
```

Stage 01 does **not** own:

```text
external media format support
HEIC/HEIF decoder selection
compressed source byte limits
video frame selection
temporal video tracking
scalar/binary derived view memoization
QR-specific detection
```

## Input

Input is the `ImageData` produced by stage 00.

Stage 00 does not define a custom decoded-frame interface, alias, or proxy. `ImageData` from the browser platform contract is the stage boundary.

Current code still has a combined public entry point:

```ts
normalizeImageInput(input)
```

That function performs media decode when needed and then calls normalization. In this spec, those responsibilities are split:

```text
00 media decode → ImageData
01 image normalization → SimpleImageData
```

## Output artifact: SimpleImageData

The canonical IronQR frame is `SimpleImageData`:

```ts
interface SimpleImageData {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}
```

Meaning:

| Field | Meaning |
| --- | --- |
| `width` | Image width in pixels. |
| `height` | Image height in pixels. |
| `data` | Flat row-major RGBA byte buffer, 4 bytes per pixel. |

`SimpleImageData` intentionally uses only the subset of browser `ImageData` that IronQR needs:

```text
width
height
Uint8ClampedArray RGBA data
```

It does not carry browser-only or runtime-specific features such as:

```text
colorSpace
pixelFormat
Float16Array HDR data
methods / DOM object identity
```

Semantic alias, if helpful in code:

```ts
type NormalizedImage = SimpleImageData;
```

Current implementation uses `rgbaPixels` rather than `data`. This spec prefers `data` to match `ImageData` unless implementation evidence shows that `rgbaPixels` avoids confusion. Either way, the canonical artifact is the same semantic object: width, height, and `Uint8ClampedArray` RGBA bytes.

## Normalization policy

Stage 01 must normalize decoded frames into this contract:

```text
row-major RGBA
8-bit unsigned clamped channels
4 bytes per pixel
pixel centers at integer coordinates
```

### Uint8ClampedArray input

If input data is already `Uint8ClampedArray` and dimensions/buffer length are valid:

```text
accept directly or copy according to ownership policy
```

### Float16Array / HDR input

Modern browser `ImageData` may use `Float16Array`, usually for HDR or wide-gamut canvas/image APIs.

This is more than “just another byte array.” It may involve:

```text
HDR transfer functions
wide-gamut color spaces
values outside normal 0..1 range
float precision
browser/runtime color-management policy
```

Until an explicit conversion policy exists, stage 01 must not silently accept `Float16Array` as canonical data.

Allowed policies:

```text
convert Float16Array to Uint8ClampedArray with a documented color/HDR policy
or reject with unsupported decoded pixel format
```

A conservative future conversion may be:

```text
convert to canonical sRGB-like 0..1
clamp to 0..1
multiply by 255
write Uint8ClampedArray
```

But this must be documented and validated with HDR/wide-gamut fixtures before becoming a product guarantee.

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
r = data[base + 0]
g = data[base + 1]
b = data[base + 2]
a = data[base + 3]
```

`width` is the row length. When `x` reaches `width`, the next pixel is the start of the next row.

## Shared RGBA pixel reader

The spec exposes a safe coordinate helper for non-hot code, tests, and documentation. This helper encodes the row-major RGBA layout in one place.

```ts
interface RgbaPixel {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const isPixelInBounds = (image: SimpleImageData, x: number, y: number): boolean =>
  Number.isInteger(x) &&
  Number.isInteger(y) &&
  x >= 0 &&
  y >= 0 &&
  x < image.width &&
  y < image.height;

const rgbaPixelOffset = (image: SimpleImageData, x: number, y: number): number => {
  if (!isPixelInBounds(image, x, y)) {
    throw new RangeError(
      `Pixel coordinate (${x}, ${y}) is outside ${image.width}x${image.height}.`,
    );
  }
  return (y * image.width + x) * 4;
};

const readRgbaPixel = (image: SimpleImageData, x: number, y: number): RgbaPixel => {
  const base = rgbaPixelOffset(image, x, y);
  return {
    r: image.data[base + 0] ?? 0,
    g: image.data[base + 1] ?? 0,
    b: image.data[base + 2] ?? 0,
    a: image.data[base + 3] ?? 0,
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

This matters because later finder geometry stores subpixel module centers and module edges. Geometry fitting must not round these points. Rounding or interpolation only belongs at image-sampling boundaries.

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
- unsupported decoded frame buffer type,
- RGBA buffers with wrong length.

For canonical output, downstream stages may assume:

```text
width > 0
height > 0
data instanceof Uint8ClampedArray
data.length === width × height × 4
```

`height` is kept as explicit metadata even though it is derivable from buffer length and width. The explicit invariant is clearer and catches mismatched buffers:

```text
data.length === width × height × 4
```

## Alpha handling

Stage 01 preserves alpha as an 8-bit RGBA channel in `SimpleImageData`.

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
SimpleImageData / NormalizedImage
  width, height, Uint8ClampedArray RGBA data only

ViewBank / ScanContext
  scalar view cache
  binary plane cache
  binary view cache
  OKLab plane cache
```

Runtime memoization does not belong inside `SimpleImageData`.

## L1 artifact metadata

If metadata is needed, it should be explicit artifact metadata, not mutable runtime cache:

```ts
interface NormalizedFrameArtifact {
  readonly image: SimpleImageData;
  readonly coordinateConvention: 'pixel-centers-at-integers';
  readonly alphaCompositePolicy: 'views-composite-on-white';
  readonly normalizedPixelFormat: 'rgba-unorm8';
}
```

The key addition is precise metadata about pixel format, coordinate policy, and alpha policy so downstream geometry has no ambiguity.

## Validation metrics

This stage itself is not a QR signal, but it affects every later signal. Reports must track:

| Metric | Purpose |
| --- | --- |
| Rejected decoded pixel formats | Ensure Float16/HDR inputs are not silently misread. |
| Normalization conversion counts | Track when stage 01 converts vs accepts directly. |
| Transparent asset behavior | QR artwork may rely on transparency. |
| Very large image materialization time | Cache and budget planning. |
| Source-dimension correlation with decode/finder failures | Very small modules can become unresolvable. |
| 8192×4320 area budget behavior across browser, Node, native, and WASM backends | Product input guarantee. |

## Cache boundary

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

Media decode policy changes belong to stage 00 and should not automatically bump L1 unless the resulting `SimpleImageData` bytes or metadata semantics change.
