import { describe, expect, it } from 'vitest';
import { decodeGrid } from '../../src/index.js';
import { helloWorldV1MGrid } from '../fixtures/hello-world-v1-m.js';

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
});
