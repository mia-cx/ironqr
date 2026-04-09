import { describe, expect, it } from 'vitest';
import { decodeGrid } from '../../src/index.js';
import {
  buildDataModulePositions,
  buildFormatInfoCodeword,
  buildFunctionModuleMask,
  buildVersionInfoCodeword,
  getRemainderBits,
  getVersionBlockInfo,
} from '../../src/internal/qr-spec.js';
import { rsEncode } from '../../src/internal/reed-solomon.js';
import { helloWorldV1MGrid } from '../fixtures/hello-world-v1-m.js';
import { helloWorldV7MGrid } from '../fixtures/hello-world-v7-m.js';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const V1_SIZE = 21;
const V1_VERSION = 1;
const V1_M_DATA_CODEWORDS = 16;
const V1_M_EC_CODEWORDS = 10;
const FORMAT_INFO_FIRST_COPY_POSITIONS: Array<readonly [number, number]> = [
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
const FORMAT_INFO_SECOND_COPY_POSITIONS: Array<readonly [number, number]> = [
  [8, V1_SIZE - 1],
  [8, V1_SIZE - 2],
  [8, V1_SIZE - 3],
  [8, V1_SIZE - 4],
  [8, V1_SIZE - 5],
  [8, V1_SIZE - 6],
  [8, V1_SIZE - 7],
  [8, V1_SIZE - 8],
  [V1_SIZE - 7, 8],
  [V1_SIZE - 6, 8],
  [V1_SIZE - 5, 8],
  [V1_SIZE - 4, 8],
  [V1_SIZE - 3, 8],
  [V1_SIZE - 2, 8],
  [V1_SIZE - 1, 8],
];
const VALID_V1_M_RS_BLOCK = [
  32, 209, 67, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236,
  236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 236, 129, 93, 188, 173, 236, 74, 208, 229, 53,
  207, 223, 112, 34, 118, 223, 231, 66, 151,
] as const;

function appendBits(bits: number[], value: number, length: number): void {
  for (let bit = length - 1; bit >= 0; bit -= 1) {
    bits.push((value >> bit) & 1);
  }
}

function bytesFromBits(bits: readonly number[]): number[] {
  const bytes: number[] = [];

  for (let index = 0; index < bits.length; index += 8) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value << 1) | (bits[index + bit] ?? 0);
    }
    bytes.push(value);
  }

  return bytes;
}

function finalizeVersion1MDataCodewords(payloadBits: readonly number[]): number[] {
  const bits = Array.from(payloadBits);
  const totalBits = V1_M_DATA_CODEWORDS * 8;

  appendBits(bits, 0, Math.min(4, totalBits - bits.length));
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  let padByte = 0xec;
  while (bits.length < totalBits) {
    appendBits(bits, padByte, 8);
    padByte = padByte === 0xec ? 0x11 : 0xec;
  }

  return bytesFromBits(bits);
}

function buildVersion1Mask0Grid(dataCodewords: readonly number[]): boolean[][] {
  const matrix = Array.from({ length: V1_SIZE }, () =>
    Array.from({ length: V1_SIZE }, () => false),
  );
  const reserved = buildFunctionModuleMask(V1_SIZE, V1_VERSION);
  const allCodewords = [
    ...dataCodewords,
    ...Array.from(rsEncode(dataCodewords, V1_M_EC_CODEWORDS)),
  ];
  const bits: number[] = [];

  const setModule = (row: number, col: number, value: boolean): void => {
    const currentRow = matrix[row];
    if (currentRow === undefined) {
      throw new Error(`Missing row ${row}.`);
    }

    currentRow[col] = value;
  };

  const drawFinder = (top: number, left: number): void => {
    for (let row = 0; row < 7; row += 1) {
      for (let col = 0; col < 7; col += 1) {
        const dark =
          row === 0 ||
          row === 6 ||
          col === 0 ||
          col === 6 ||
          (row >= 2 && row <= 4 && col >= 2 && col <= 4);
        setModule(top + row, left + col, dark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(0, V1_SIZE - 7);
  drawFinder(V1_SIZE - 7, 0);

  for (let index = 8; index < V1_SIZE - 8; index += 1) {
    setModule(6, index, index % 2 === 0);
    setModule(index, 6, index % 2 === 0);
  }

  const formatBits = buildFormatInfoCodeword('M', 0);
  for (let index = 0; index < FORMAT_INFO_FIRST_COPY_POSITIONS.length; index += 1) {
    const position = FORMAT_INFO_FIRST_COPY_POSITIONS[index];
    if (!position) {
      continue;
    }

    setModule(position[0], position[1], ((formatBits >> (14 - index)) & 1) === 1);
  }

  for (let index = 0; index < FORMAT_INFO_SECOND_COPY_POSITIONS.length; index += 1) {
    const position = FORMAT_INFO_SECOND_COPY_POSITIONS[index];
    if (!position) {
      continue;
    }

    setModule(position[0], position[1], ((formatBits >> (14 - index)) & 1) === 1);
  }

  setModule(V1_SIZE - 8, 8, true);

  for (const codeword of allCodewords) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      bits.push((codeword >> bit) & 1);
    }
  }

  const positions = buildDataModulePositions(V1_SIZE, reserved);
  if (positions.length !== bits.length) {
    throw new Error(`Fixture mismatch: ${positions.length} data modules, ${bits.length} bits.`);
  }

  for (let index = 0; index < positions.length; index += 1) {
    const position = positions[index];
    if (!position) {
      continue;
    }

    const [row, col] = position;
    const bit = bits[index] === 1;
    const applyMask = (row + col) % 2 === 0;
    setModule(row, col, applyMask ? !bit : bit);
  }

  return matrix;
}

function buildFnc1SecondPositionGrid(): boolean[][] {
  const bits: number[] = [];

  appendBits(bits, 0b1001, 4);
  appendBits(bits, 0x41, 8);
  appendBits(bits, 0b0010, 4);
  appendBits(bits, 2, 9);
  appendBits(bits, 10 * 45 + 11, 11);

  return buildVersion1Mask0Grid(finalizeVersion1MDataCodewords(bits));
}

describe('decodeGrid', () => {
  it('decodes the version 1-M HELLO WORLD logical grid end-to-end', async () => {
    const result = await decodeGrid({ grid: helloWorldV1MGrid });

    expect(result.version).toBe(1);
    expect(result.errorCorrectionLevel).toBe('M');
    expect(result.payload.kind).toBe('text');
    expect(result.payload.text).toBe('HELLO WORLD');
    expect(new TextDecoder().decode(result.payload.bytes)).toBe('HELLO WORLD');
    expect(result.headers.length).toBeGreaterThan(0);
  });

  it('decodes a version 7-M HELLO WORLD logical grid end-to-end', async () => {
    const result = await decodeGrid({ grid: helloWorldV7MGrid });

    expect(result.version).toBe(7);
    expect(result.errorCorrectionLevel).toBe('M');
    expect(result.payload.kind).toBe('text');
    expect(result.payload.text).toBe('HELLO WORLD');
    expect(new TextDecoder().decode(result.payload.bytes)).toBe('HELLO WORLD');
  });

  it('initializes GF tables before correcting a valid RS block in a fresh process', async () => {
    // @ts-expect-error Vitest runs on Node-compatible APIs here even though the repo does not ship Node typings.
    const { execFileSync } = await import('node:child_process');
    const command = `import { correctRsBlock } from './src/internal/reed-solomon.ts'; const block = ${JSON.stringify(VALID_V1_M_RS_BLOCK)}; console.log(JSON.stringify(Array.from(correctRsBlock(block, 18))));`;
    const output = execFileSync(process.execPath, ['-e', command], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(JSON.parse(output.trim())).toEqual(VALID_V1_M_RS_BLOCK);
  });

  it('wraps unrecoverable RS failures in ScannerError at the public decode boundary', async () => {
    const grid = helloWorldV1MGrid.map((row) => row.slice());
    const reserved = buildFunctionModuleMask(grid.length, 1);
    const positions = buildDataModulePositions(grid.length, reserved);

    for (let index = 0; index < 96; index += 1) {
      const position = positions[index];
      if (!position) {
        continue;
      }

      const [row, col] = position;
      const currentRow = grid[row];
      if (!currentRow) {
        continue;
      }

      currentRow[col] = !currentRow[col];
    }

    await expect(decodeGrid({ grid })).rejects.toMatchObject({
      name: 'ScannerError',
      code: 'decode_failed',
      message: expect.stringContaining('Reed-Solomon'),
    });
  });

  it('consumes the FNC1 second-position application indicator before decoding later segments', async () => {
    const result = await decodeGrid({ grid: buildFnc1SecondPositionGrid() });

    expect(result.payload.text).toBe('AB');
    expect(result.headers).toContainEqual(['mode', 'fnc1-second']);
    expect(result.headers).toContainEqual(['application-indicator', '65']);
    expect(new TextDecoder().decode(result.payload.bytes)).toBe('AB');
  });

  it('covers the full QR Model 2 version range in the data-module and RS tables', () => {
    expect(buildVersionInfoCodeword(7)).toBe(0x7c94);

    for (let version = 1; version <= 40; version += 1) {
      const size = 17 + version * 4;
      const reserved = buildFunctionModuleMask(size, version);
      const positions = buildDataModulePositions(size, reserved);
      const blockInfo = getVersionBlockInfo(version, 'M');

      expect(reserved.length).toBe(size);
      expect(positions).toHaveLength(blockInfo.totalCodewords * 8 + getRemainderBits(version));
    }
  });
});
