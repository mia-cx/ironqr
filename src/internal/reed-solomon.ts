const PRIMITIVE_POLY = 0x11d;

let tablesInitialized = false;
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

function initializeTables(): void {
  if (tablesInitialized) {
    return;
  }

  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP_TABLE[i] = x;
    LOG_TABLE[x] = i;
    x <<= 1;
    if ((x & 0x100) !== 0) {
      x ^= PRIMITIVE_POLY;
    }
  }

  for (let i = 255; i < EXP_TABLE.length; i += 1) {
    EXP_TABLE[i] = EXP_TABLE[i - 255] ?? 0;
  }

  tablesInitialized = true;
}

function gfMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }

  initializeTables();
  return EXP_TABLE[(LOG_TABLE[left] ?? 0) + (LOG_TABLE[right] ?? 0)] ?? 0;
}

function polynomialMultiply(left: readonly number[], right: readonly number[]): number[] {
  const result = new Array<number>(left.length + right.length - 1).fill(0);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      result[leftIndex + rightIndex] =
        (result[leftIndex + rightIndex] ?? 0) ^
        gfMultiply(left[leftIndex] ?? 0, right[rightIndex] ?? 0);
    }
  }

  return result;
}

function buildGeneratorPolynomial(ecCodewords: number): number[] {
  initializeTables();

  let generator = [1];
  for (let i = 0; i < ecCodewords; i += 1) {
    generator = polynomialMultiply(generator, [1, EXP_TABLE[i] ?? 0]);
  }

  return generator;
}

export function rsEncode(data: readonly number[], ecCodewords: number): Uint8Array {
  const generator = buildGeneratorPolynomial(ecCodewords);
  const buffer = new Uint8Array(data.length + ecCodewords);
  buffer.set(data);

  for (let index = 0; index < data.length; index += 1) {
    const factor = buffer[index] ?? 0;
    if (factor === 0) {
      continue;
    }

    for (let generatorIndex = 0; generatorIndex < generator.length; generatorIndex += 1) {
      buffer[index + generatorIndex] =
        (buffer[index + generatorIndex] ?? 0) ^ gfMultiply(generator[generatorIndex] ?? 0, factor);
    }
  }

  return buffer.slice(data.length);
}

export function verifyRsBlock(data: readonly number[], ecc: readonly number[]): boolean {
  const expected = rsEncode(data, ecc.length);

  if (expected.length !== ecc.length) {
    return false;
  }

  for (let index = 0; index < ecc.length; index += 1) {
    if ((expected[index] ?? 0) !== (ecc[index] ?? 0)) {
      return false;
    }
  }

  return true;
}
