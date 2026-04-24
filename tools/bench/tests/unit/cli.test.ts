import { describe, expect, it } from 'bun:test';
import { parseArgs } from '../../src/cli.js';

describe('bench cli args', () => {
  it('keeps ironqr cache and OpenTUI progress enabled by default', () => {
    const { options } = parseArgs(['accuracy']);
    expect(options.cacheEnabled).toBe(true);
    expect(options.ironqrCacheEnabled).toBe(true);
    expect(options.progressEnabled).toBe(true);
  });

  it('can disable only the ironqr cache', () => {
    const { options } = parseArgs(['accuracy', '--no-ironqr-cache']);
    expect(options.cacheEnabled).toBe(true);
    expect(options.ironqrCacheEnabled).toBe(false);
  });

  it('can disable every accuracy cache', () => {
    const { options } = parseArgs(['accuracy', '--no-cache']);
    expect(options.cacheEnabled).toBe(false);
    expect(options.ironqrCacheEnabled).toBe(true);
  });

  it('keeps ironqr trace disabled by default', () => {
    const { options } = parseArgs(['accuracy']);
    expect(options.ironqrTraceMode).toBe('off');
  });

  it('accepts help after a mode', () => {
    const { mode, options } = parseArgs(['accuracy', '--help']);
    expect(mode).toBe('accuracy');
    expect(options.help).toBe(true);
  });

  it('rejects partially numeric worker counts', () => {
    expect(() => parseArgs(['accuracy', '--workers=2abc'])).toThrow('positive integer');
    expect(() => parseArgs(['accuracy', '--workers', '1.5'])).toThrow('positive integer');
  });

  it('only supports disabling OpenTUI progress', () => {
    expect(parseArgs(['accuracy', '--quiet']).options.progressEnabled).toBe(false);
    expect(parseArgs(['accuracy', '--no-progress']).options.progressEnabled).toBe(false);
    expect(() => parseArgs(['accuracy', '--progress=plain'])).toThrow('Use --no-progress');
    expect(() => parseArgs(['accuracy', '--progress', 'dashboard'])).toThrow('Use --no-progress');
  });
});
