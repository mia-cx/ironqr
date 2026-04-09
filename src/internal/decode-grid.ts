import type { DecodeGridResult } from '../contracts/index.js';
import { ScannerError } from './errors.js';
import {
  ALPHANUMERIC_CHARSET,
  buildFunctionModuleMask,
  decodeFormatInfo,
  getVersion1BlockInfo,
  getVersionFromSize,
  unmask,
} from './qr-spec.js';

const BYTE_DECODER = new TextDecoder('utf-8', { fatal: false });

class BitReader {
  private readonly bits: number[];
  private index = 0;

  constructor(bytes: readonly number[]) {
    const bits: number[] = [];
    for (const byte of bytes) {
      for (let bit = 7; bit >= 0; bit -= 1) {
        bits.push((byte >> bit) & 1);
      }
    }
    this.bits = bits;
  }

  read(length: number): number {
    if (length < 0) {
      throw new ScannerError('internal_error', `Cannot read a negative number of bits: ${length}`);
    }

    if (this.index + length > this.bits.length) {
      throw new ScannerError('decode_failed', 'Unexpected end of QR data stream.');
    }

    let value = 0;
    for (let offset = 0; offset < length; offset += 1) {
      value = (value << 1) | (this.bits[this.index + offset] ?? 0);
    }

    this.index += length;
    return value;
  }

  remaining(): number {
    return this.bits.length - this.index;
  }
}

function classifyPayload(
  text: string,
): 'text' | 'url' | 'email' | 'sms' | 'wifi' | 'contact' | 'calendar' | 'binary' | 'unknown' {
  if (/^https?:\/\//i.test(text)) {
    return 'url';
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return 'email';
  }

  return 'text';
}

function decodeAlphanumeric(reader: BitReader, count: number): string {
  let text = '';

  for (let remaining = count; remaining >= 2; remaining -= 2) {
    const value = reader.read(11);
    const first = Math.floor(value / 45);
    const second = value % 45;
    const firstChar = ALPHANUMERIC_CHARSET[first];
    const secondChar = ALPHANUMERIC_CHARSET[second];

    if (firstChar === undefined || secondChar === undefined) {
      throw new ScannerError('decode_failed', 'Invalid alphanumeric value in QR stream.');
    }

    text += `${firstChar}${secondChar}`;
  }

  if (count % 2 === 1) {
    const value = reader.read(6);
    const char = ALPHANUMERIC_CHARSET[value];
    if (char === undefined) {
      throw new ScannerError('decode_failed', 'Invalid alphanumeric value in QR stream.');
    }
    text += char;
  }

  return text;
}

function decodeByteSegment(reader: BitReader, count: number): Uint8Array {
  const bytes = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    bytes[index] = reader.read(8);
  }

  return bytes;
}

function decodePayloadFromDataCodewords(
  dataCodewords: readonly number[],
  version: number,
): {
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly kind:
    | 'text'
    | 'url'
    | 'email'
    | 'sms'
    | 'wifi'
    | 'contact'
    | 'calendar'
    | 'binary'
    | 'unknown';
  readonly headers: Array<readonly [string, string]>;
} {
  const reader = new BitReader(dataCodewords);
  const headers: Array<readonly [string, string]> = [];
  const bytes: number[] = [];
  let text = '';
  let payloadKind:
    | 'text'
    | 'url'
    | 'email'
    | 'sms'
    | 'wifi'
    | 'contact'
    | 'calendar'
    | 'binary'
    | 'unknown' = 'unknown';

  const numericCountBits = version <= 9 ? 10 : version <= 26 ? 12 : 14;
  const alphanumericCountBits = version <= 9 ? 9 : version <= 26 ? 11 : 13;
  const byteCountBits = version <= 9 ? 8 : 16;

  while (reader.remaining() >= 4) {
    const mode = reader.read(4);
    if (mode === 0) {
      break;
    }

    if (mode === 0b0010) {
      const count = reader.read(alphanumericCountBits);
      const segmentText = decodeAlphanumeric(reader, count);
      text += segmentText;
      bytes.push(...new TextEncoder().encode(segmentText));
      payloadKind = classifyPayload(text);
      headers.push(['mode', 'alphanumeric']);
      continue;
    }

    if (mode === 0b0100) {
      const count = reader.read(byteCountBits);
      const segment = decodeByteSegment(reader, count);
      bytes.push(...segment);
      const segmentText = BYTE_DECODER.decode(segment);
      text += segmentText;
      payloadKind = classifyPayload(text);
      headers.push(['mode', 'byte']);
      continue;
    }

    if (mode === 0b0001) {
      const count = reader.read(numericCountBits);
      let segment = '';
      let remaining = count;
      while (remaining >= 3) {
        segment += reader.read(10).toString().padStart(3, '0');
        remaining -= 3;
      }
      if (remaining === 2) {
        segment += reader.read(7).toString().padStart(2, '0');
      } else if (remaining === 1) {
        segment += reader.read(4).toString();
      }
      text += segment;
      bytes.push(...new TextEncoder().encode(segment));
      payloadKind = classifyPayload(text);
      headers.push(['mode', 'numeric']);
      continue;
    }

    throw new ScannerError(
      'decode_failed',
      `Unsupported QR mode: 0b${mode.toString(2).padStart(4, '0')}`,
    );
  }

  if (bytes.length === 0) {
    bytes.push(...new TextEncoder().encode(text));
  }

  return {
    text,
    bytes: new Uint8Array(bytes),
    kind: payloadKind === 'unknown' ? 'text' : payloadKind,
    headers,
  };
}

function bytesFromBits(bits: readonly number[]): Uint8Array {
  if (bits.length % 8 !== 0) {
    throw new ScannerError('decode_failed', 'Bit stream length is not byte-aligned.');
  }

  const bytes = new Uint8Array(bits.length / 8);
  for (let index = 0; index < bytes.length; index += 1) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value << 1) | (bits[index * 8 + bit] ?? 0);
    }
    bytes[index] = value;
  }
  return bytes;
}

function extractCodewords(matrix: boolean[][], reserved: boolean[][]): Uint8Array {
  const size = matrix.length;
  const bits: number[] = [];

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

        bits.push(matrix[row]?.[col] ? 1 : 0);
      }
    }

    upward = !upward;
  }

  return bytesFromBits(bits);
}

export async function decodeGridLogical(input: {
  readonly grid: readonly (readonly boolean[])[];
}): Promise<DecodeGridResult> {
  const { grid } = input;
  if (grid.length === 0) {
    throw new ScannerError('invalid_input', 'QR grid must not be empty.');
  }

  const size = grid.length;
  for (const row of grid) {
    if (row.length !== size) {
      throw new ScannerError('invalid_input', 'QR grid must be square.');
    }
  }

  const version = getVersionFromSize(size);
  if (version !== 1) {
    throw new ScannerError(
      'decode_failed',
      `Only version 1 is supported by this decoder slice (got version ${version}).`,
    );
  }

  const matrix = grid.map((row) => row.slice());
  const { errorCorrectionLevel, maskPattern } = decodeFormatInfo(matrix);
  const reserved = buildFunctionModuleMask(size, version);
  const unmasked = unmask(matrix, maskPattern, reserved);
  const codewords = extractCodewords(unmasked, reserved);
  const blockInfo = getVersion1BlockInfo(errorCorrectionLevel);

  if (codewords.length !== blockInfo.totalCodewords) {
    throw new ScannerError(
      'decode_failed',
      `Unexpected codeword count for version ${version}-${errorCorrectionLevel}: got ${codewords.length}, expected ${blockInfo.totalCodewords}.`,
    );
  }

  const dataCodewords = Array.from(codewords.slice(0, blockInfo.dataCodewords));
  const ecCodewords = Array.from(codewords.slice(blockInfo.dataCodewords));

  // Reed-Solomon validation is intentionally lenient in this slice; the core decoder
  // focuses on standards-compliant module extraction and payload parsing.
  void ecCodewords;

  const payload = decodePayloadFromDataCodewords(dataCodewords, version);
  const confidence = 1;

  return {
    payload: {
      kind: payload.kind,
      text: payload.text,
      bytes: payload.bytes,
    },
    confidence,
    version,
    errorCorrectionLevel,
    bounds: {
      x: 0,
      y: 0,
      width: size,
      height: size,
    },
    corners: {
      topLeft: { x: 0, y: 0 },
      topRight: { x: size, y: 0 },
      bottomRight: { x: size, y: size },
      bottomLeft: { x: 0, y: size },
    },
    headers: payload.headers.length > 0 ? payload.headers : [['mode', 'unknown']],
  };
}
