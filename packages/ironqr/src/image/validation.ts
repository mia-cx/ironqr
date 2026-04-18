const assertDimension = (name: string, value: number, context: string): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${context}: ${name} must be a non-negative integer, got ${value}.`);
  }
};

export const assertImageBufferLength = (
  bufferLength: number,
  width: number,
  height: number,
  channels: number,
  context: string,
): void => {
  assertDimension('width', width, context);
  assertDimension('height', height, context);
  assertDimension('channels', channels, context);

  const expectedLength = width * height * channels;
  if (bufferLength !== expectedLength) {
    throw new RangeError(
      `${context}: expected buffer length ${expectedLength} for ${width}×${height}×${channels}, got ${bufferLength}.`,
    );
  }
};

export const assertImagePlaneLength = (
  bufferLength: number,
  width: number,
  height: number,
  context: string,
): void => {
  assertImageBufferLength(bufferLength, width, height, 1, context);
};

export const normalizeWindowRadius = (
  radius: number,
  maxRadius: number,
  context: string,
): number => {
  if (!Number.isFinite(radius)) {
    throw new RangeError(`${context}: radius must be finite, got ${radius}.`);
  }

  const normalized = Math.trunc(radius);
  if (normalized < 0) {
    throw new RangeError(`${context}: radius must be non-negative, got ${radius}.`);
  }

  return Math.min(normalized, maxRadius);
};
