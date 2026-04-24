import { describe, expect, it } from 'bun:test';
import { scanFrame } from '../../src/index.js';
import { buildHiGrid, gridToImageData } from '../helpers.js';

describe('scanFrame observability', () => {
  it('returns a report envelope when observability is requested', async () => {
    const imageData = gridToImageData(buildHiGrid());
    const report = await scanFrame(imageData, {
      observability: {
        result: {
          path: 'basic',
          attempts: 'summary',
        },
        scan: {
          timings: 'full',
          failure: 'summary',
        },
      },
    });

    expect('results' in report).toBe(true);
    expect('scan' in report).toBe(true);
    if (!('results' in report) || !('scan' in report)) return;

    expect(report.results).toHaveLength(1);
    const first = report.results[0];
    expect(first?.payload.text).toBe('HI');
    expect(first?.metadata.path?.proposalId).toBeString();
    expect(first?.metadata.path?.proposalBinaryViewId).toBeString();
    expect(first?.metadata.path?.decodeAttempt.decodeBinaryViewId).toBeString();
    expect(first?.metadata.attempts?.attemptCount).toBeGreaterThan(0);
    expect(report.scan.summary.successCount).toBe(1);
    expect(report.scan.failure?.succeeded).toBe(true);
    expect(report.scan.timings && 'attempts' in report.scan.timings).toBe(true);
    if (report.scan.timings && 'attempts' in report.scan.timings) {
      expect(report.scan.timings.attempts.length).toBeGreaterThan(0);
    }
  });

  it('keeps the plain array contract when observability is omitted', async () => {
    const imageData = gridToImageData(buildHiGrid());
    const results = await scanFrame(imageData);

    expect(Array.isArray(results)).toBe(true);
    expect(results[0]?.payload.text).toBe('HI');
  });
});
