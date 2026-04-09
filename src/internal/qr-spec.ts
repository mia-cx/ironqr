import { ScannerError } from './errors.js';

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

export const ALPHANUMERIC_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:' as const;

export const FORMAT_INFO_ECL_BITS: Record<QrErrorCorrectionLevel, number> = {
  L: 0b01,
  M: 0b00,
  Q: 0b11,
  H: 0b10,
};

export function getVersionFromSize(size: number): number {
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 40) {
    throw new ScannerError('invalid_input', `Invalid QR grid size: ${size}`);
  }

  return version;
}

export function maskApplies(maskPattern: number, row: number, col: number): boolean {
  switch (maskPattern) {
    case 0:
      return (row + col) % 2 === 0;
    case 1:
      return row % 2 === 0;
    case 2:
      return col % 2 === 0;
    case 3:
      return (row + col) % 3 === 0;
    case 4:
      return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
    case 5:
      return ((row * col) % 2) + ((row * col) % 3) === 0;
    case 6:
      return (((row * col) % 2) + ((row * col) % 3)) % 2 === 0;
    case 7:
      return (((row + col) % 2) + ((row * col) % 3)) % 2 === 0;
    default:
      throw new ScannerError('decode_failed', `Unsupported mask pattern: ${maskPattern}`);
  }
}

function createMatrix(size: number, value: boolean): boolean[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => value));
}

function markRectangle(
  mask: boolean[][],
  top: number,
  left: number,
  height: number,
  width: number,
): void {
  for (let row = top; row < top + height; row += 1) {
    const currentRow = mask[row];
    if (!currentRow) {
      continue;
    }

    for (let col = left; col < left + width; col += 1) {
      if (currentRow[col] !== undefined) {
        currentRow[col] = true;
      }
    }
  }
}

export function buildFunctionModuleMask(size: number, version: number): boolean[][] {
  const mask = createMatrix(size, false);

  if (version !== 1) {
    throw new ScannerError(
      'decode_failed',
      `Only QR version 1 is supported right now (got version ${version}).`,
    );
  }

  markRectangle(mask, 0, 0, 8, 8);
  markRectangle(mask, 0, size - 8, 8, 8);
  markRectangle(mask, size - 8, 0, 8, 8);

  const timingRow = mask[6];
  if (timingRow === undefined) {
    throw new ScannerError('internal_error', 'Missing timing row while building QR function mask.');
  }

  for (let index = 0; index < size; index += 1) {
    timingRow[index] = true;
    const timingColumnRow = mask[index];
    if (timingColumnRow === undefined) {
      throw new ScannerError(
        'internal_error',
        'Missing timing column while building QR function mask.',
      );
    }
    timingColumnRow[6] = true;
  }

  // First format information copy.
  markRectangle(mask, 0, 0, 9, 9);

  // Second format information copy.
  markRectangle(mask, 8, size - 8, 1, 8);
  markRectangle(mask, size - 7, 8, 7, 1);

  // Dark module.
  const darkModuleRow = mask[size - 8];
  if (darkModuleRow === undefined) {
    throw new ScannerError(
      'internal_error',
      'Missing dark module row while building QR function mask.',
    );
  }
  darkModuleRow[8] = true;

  return mask;
}

function readBits(matrix: boolean[][], positions: readonly (readonly [number, number])[]): number {
  let value = 0;

  for (const [row, col] of positions) {
    value = (value << 1) | (matrix[row]?.[col] ? 1 : 0);
  }

  return value;
}

function bitCount(value: number): number {
  let count = 0;
  let bits = value;

  while (bits !== 0) {
    bits &= bits - 1;
    count += 1;
  }

  return count;
}

function buildFormatInfoCodeword(ecl: QrErrorCorrectionLevel, maskPattern: number): number {
  const data = ((FORMAT_INFO_ECL_BITS[ecl] ?? 0) << 3) | maskPattern;
  let value = data << 10;
  const generator = 0x537;

  for (let bit = 14; bit >= 10; bit -= 1) {
    if ((value & (1 << bit)) === 0) {
      continue;
    }

    value ^= generator << (bit - 10);
  }

  return (value ^ 0x5412) & 0x7fff;
}

export function decodeFormatInfo(matrix: boolean[][]): {
  readonly errorCorrectionLevel: QrErrorCorrectionLevel;
  readonly maskPattern: number;
} {
  const firstCopyPositions: readonly (readonly [number, number])[] = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];

  const observed = readBits(matrix, firstCopyPositions);

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestEcl: QrErrorCorrectionLevel = 'M';
  let bestMask = 0;

  for (const ecl of ['L', 'M', 'Q', 'H'] as const) {
    for (let maskPattern = 0; maskPattern < 8; maskPattern += 1) {
      const candidate = buildFormatInfoCodeword(ecl, maskPattern);
      const distance = bitCount(candidate ^ observed);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestEcl = ecl;
        bestMask = maskPattern;
      }
    }
  }

  if (bestDistance > 3) {
    throw new ScannerError('decode_failed', 'Could not decode QR format information.');
  }

  return { errorCorrectionLevel: bestEcl, maskPattern: bestMask };
}

export function getVersion1BlockInfo(errorCorrectionLevel: QrErrorCorrectionLevel): {
  readonly totalCodewords: number;
  readonly dataCodewords: number;
  readonly ecCodewords: number;
} {
  switch (errorCorrectionLevel) {
    case 'L':
      return { totalCodewords: 26, dataCodewords: 19, ecCodewords: 7 };
    case 'M':
      return { totalCodewords: 26, dataCodewords: 16, ecCodewords: 10 };
    case 'Q':
      return { totalCodewords: 26, dataCodewords: 13, ecCodewords: 13 };
    case 'H':
      return { totalCodewords: 26, dataCodewords: 9, ecCodewords: 17 };
  }
}

export function buildDataModulePositions(
  size: number,
  reserved: boolean[][],
): Array<readonly [number, number]> {
  const positions: Array<readonly [number, number]> = [];

  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    const currentRight = right === 6 ? right - 1 : right;
    const currentLeft = currentRight - 1;

    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const col of [currentRight, currentLeft] as const) {
        if (reserved[row]?.[col]) {
          continue;
        }

        positions.push([row, col]);
      }
    }

    upward = !upward;
  }

  return positions;
}

export function unmask(
  matrix: boolean[][],
  maskPattern: number,
  reserved: boolean[][],
): boolean[][] {
  const size = matrix.length;
  const output = matrix.map((row) => row.slice());

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (reserved[row]?.[col]) {
        continue;
      }

      if (maskApplies(maskPattern, row, col)) {
        const currentRow = output[row];
        if (currentRow === undefined) {
          throw new ScannerError('internal_error', 'Missing output row while applying QR mask.');
        }
        currentRow[col] = !currentRow[col];
      }
    }
  }

  return output;
}
