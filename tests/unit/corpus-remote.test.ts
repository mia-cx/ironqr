import { describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  importStagedRemoteAssets,
  readStagedRemoteAsset,
  scrapeRemoteAssets,
  updateStagedRemoteAsset,
} from '../../corpus/import/remote.js';
import { readCorpusManifest } from '../../corpus/manifest.js';

const LISTING_HTML = `
  <html>
    <body>
      <a href="/photos/first-qr-123/">first</a>
      <a href="/photos/second-qr-456/">second</a>
    </body>
  </html>
`;

const FIRST_PAGE_HTML = `
  <html>
    <head>
      <title>First QR</title>
      <meta property="og:image" content="https://cdn.example.test/first.png" />
      <div>Pixabay License</div>
    </head>
  </html>
`;

const SECOND_PAGE_HTML = `
  <html>
    <head>
      <title>Second QR</title>
      <meta property="og:image" content="https://cdn.example.test/second.png" />
      <div>Pixabay License</div>
    </head>
  </html>
`;

async function createPngBytes(red: number, green: number, blue: number): Promise<Uint8Array> {
  const buffer = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: red, g: green, b: blue, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  return new Uint8Array(buffer);
}

async function createRepoRoot(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'qreader-corpus-remote-'));
  await mkdir(path.join(repoRoot, 'corpus'), { recursive: true });
  return repoRoot;
}

function buildMockFetch(): (input: string | URL) => Promise<Response> {
  return async (input) => {
    const url = typeof input === 'string' ? input : input.toString();

    const firstBytes = await createPngBytes(255, 255, 255);
    const secondBytes = await createPngBytes(0, 0, 0);

    if (url === 'https://pixabay.com/images/search/qr%20code/') {
      return new Response(LISTING_HTML, {
        headers: { 'content-type': 'text/html' },
      });
    }

    if (url === 'https://pixabay.com/photos/first-qr-123/') {
      return new Response(FIRST_PAGE_HTML, {
        headers: { 'content-type': 'text/html' },
      });
    }

    if (url === 'https://pixabay.com/photos/second-qr-456/') {
      return new Response(SECOND_PAGE_HTML, {
        headers: { 'content-type': 'text/html' },
      });
    }

    if (url === 'https://cdn.example.test/first.png') {
      return new Response(Buffer.from(firstBytes), {
        headers: { 'content-type': 'image/png' },
      });
    }

    if (url === 'https://cdn.example.test/second.png') {
      return new Response(Buffer.from(secondBytes), {
        headers: { 'content-type': 'image/png' },
      });
    }

    return new Response('not found', { status: 404 });
  };
}

describe('remote corpus import', () => {
  it('stages remote assets in per-image folders, then imports them with remote provenance', async () => {
    const repoRoot = await createRepoRoot();

    const staged = await scrapeRemoteAssets(
      {
        repoRoot,
        seedUrls: ['https://pixabay.com/images/search/qr%20code/'],
        label: 'qr-positive',
        limit: 2,
      },
      buildMockFetch(),
    );

    expect(staged.assets).toHaveLength(2);
    expect(staged.assets[0]?.imageFileName).toBe('image.png');

    const stagedAssetPath = path.join(
      staged.stageDir,
      staged.assets[0]?.id ?? 'missing',
      staged.assets[0]?.imageFileName ?? 'image.png',
    );
    expect((await readFile(stagedAssetPath)).length).toBeGreaterThan(0);

    const result = await importStagedRemoteAssets({
      repoRoot,
      stageDir: staged.stageDir,
      reviewStatus: 'approved',
      reviewer: 'mia',
    });

    expect(result.imported).toHaveLength(2);
    expect(result.deduped).toHaveLength(0);

    const manifest = await readCorpusManifest(repoRoot);
    expect(manifest.assets).toHaveLength(2);

    const firstAsset = manifest.assets.find(
      (asset) =>
        asset.provenance[0]?.kind === 'remote' &&
        asset.provenance[0].sourcePageUrl === 'https://pixabay.com/photos/first-qr-123/',
    );

    expect(firstAsset?.review.status).toBe('approved');
    expect(firstAsset?.provenance[0]).toMatchObject({
      kind: 'remote',
      sourcePageUrl: 'https://pixabay.com/photos/first-qr-123/',
      imageUrl: 'https://cdn.example.test/first.png',
      pageTitle: 'First QR',
    });
    expect(firstAsset?.fileExtension).toBe('.webp');
    expect(firstAsset?.mediaType).toBe('image/webp');

    const storedAssetPath = path.join(repoRoot, 'corpus', 'data', firstAsset?.relativePath ?? '');
    expect((await readFile(storedAssetPath)).length).toBeGreaterThan(0);
  });

  it('imports approved staged metadata for license review, ground truth, and auto-scan evidence', async () => {
    const repoRoot = await createRepoRoot();

    const staged = await scrapeRemoteAssets(
      {
        repoRoot,
        seedUrls: ['https://pixabay.com/images/search/qr%20code/'],
        label: 'qr-positive',
        limit: 1,
      },
      buildMockFetch(),
    );

    const asset = staged.assets[0];
    expect(asset).toBeDefined();
    if (!asset) {
      throw new Error('expected staged asset');
    }

    await updateStagedRemoteAsset(staged.stageDir, {
      ...asset,
      review: {
        status: 'approved',
        reviewer: 'mia',
        reviewedAt: '2026-04-10T12:00:00.000Z',
        notes: 'verified from phone scan',
      },
      confirmedLicense: 'CC0',
      groundTruth: {
        qrCount: 1,
        codes: [
          {
            text: 'https://example.com',
            kind: 'url',
            verifiedWith: 'iphone camera',
          },
        ],
      },
      autoScan: {
        attempted: true,
        succeeded: true,
        results: [{ text: 'https://example.com', kind: 'url' }],
        acceptedAsTruth: true,
      },
    });

    const result = await importStagedRemoteAssets({
      repoRoot,
      stageDir: staged.stageDir,
    });

    expect(result.imported).toHaveLength(1);

    const manifest = await readCorpusManifest(repoRoot);
    const imported = manifest.assets[0];
    expect(imported?.licenseReview).toMatchObject({
      bestEffortLicense: 'Pixabay License',
      confirmedLicense: 'CC0',
      licenseVerifiedBy: 'mia',
      licenseVerifiedAt: '2026-04-10T12:00:00.000Z',
    });
    expect(imported?.groundTruth).toEqual({
      qrCount: 1,
      codes: [
        {
          text: 'https://example.com',
          kind: 'url',
          verifiedWith: 'iphone camera',
        },
      ],
    });
    expect(imported?.autoScan).toEqual({
      attempted: true,
      succeeded: true,
      results: [{ text: 'https://example.com', kind: 'url' }],
      acceptedAsTruth: true,
    });

    const persistedStage = await readStagedRemoteAsset(staged.stageDir, asset.id);
    expect(persistedStage.importedAssetId).toBe(imported?.id);
  });

  it('rejects seed urls outside the explicit allowlist', async () => {
    const repoRoot = await createRepoRoot();

    await expect(
      scrapeRemoteAssets(
        {
          repoRoot,
          seedUrls: ['https://example.com/not-allowed'],
          label: 'non-qr-negative',
        },
        buildMockFetch(),
      ),
    ).rejects.toThrow('allowlist');
  });
});
