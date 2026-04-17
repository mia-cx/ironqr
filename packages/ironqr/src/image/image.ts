import type { BrowserImageSource, ImageDataLike } from '../contracts/scan.js';

const RGBA_CHANNELS = 4;

/**
 * Structural match for anything that already looks like raw pixel data, so
 * non-DOM hosts (Bun, Node tooling, workers) can pass in `{ width, height,
 * data }` buffers without constructing a real `ImageData` instance.
 */
const isImageDataLike = (value: unknown): value is ImageDataLike => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as {
    readonly width?: unknown;
    readonly height?: unknown;
    readonly data?: unknown;
  };

  if (
    !Number.isInteger(candidate.width) ||
    !Number.isInteger(candidate.height) ||
    typeof candidate.width !== 'number' ||
    typeof candidate.height !== 'number'
  ) {
    return false;
  }

  if (candidate.width < 0 || candidate.height < 0) {
    return false;
  }

  if (!(candidate.data instanceof Uint8ClampedArray)) {
    return false;
  }

  return candidate.data.length === candidate.width * candidate.height * RGBA_CHANNELS;
};

/**
 * Converts any supported browser image source into raw pixel data.
 *
 * Accepts anything that is already pixel-backed (real `ImageData` or the
 * structural equivalent). Otherwise falls back to `createImageBitmap` +
 * `OffscreenCanvas`, which is the standard browser path.
 *
 * @param source - Browser image source to convert.
 * @returns Pixel-backed image data containing the full source content.
 */
export const toImageData = async (source: BrowserImageSource): Promise<ImageDataLike> => {
  if (isImageDataLike(source)) {
    return source;
  }

  const bitmap = await createImageBitmap(source);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    bitmap.close();
    throw new Error(
      `Failed to get 2d context from OffscreenCanvas for ${bitmap.width}×${bitmap.height} bitmap.`,
    );
  }

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();

  return imageData;
};
