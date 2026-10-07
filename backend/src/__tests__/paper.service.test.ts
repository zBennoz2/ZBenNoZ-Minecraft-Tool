import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { PaperService, PAPER_PROJECT_URL, PAPER_USER_AGENT } from '../core/PaperService';
import { CatalogService } from '../core/CatalogService';
import { DownloadService } from '../core/DownloadService';
import catalogRouter from '../api/catalog';

const jar = Buffer.from('verified-test-jar');
const checksum = createHash('sha256').update(jar).digest('hex');
const build = (id: number, channel = 'STABLE', sha256 = checksum) => ({
  id, channel, time: '2026-01-01T00:00:00Z',
  downloads: { 'server:default': { url: `https://fill-data.papermc.io/v1/objects/${sha256}/paper-${id}.jar`, checksums: { sha256 } } },
});

test('Paper v3 grouped versions are flattened, deduplicated, sorted and cached', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls += 1;
    assert.equal(url, PAPER_PROJECT_URL);
    assert.equal(new Headers(init.headers).get('User-Agent'), PAPER_USER_AGENT);
    assert.ok(init.signal);
    return Response.json({ versions: { '1.20': ['1.20.6'], '1.21': ['1.21.1', '1.21.10', '1.21.1'] } });
  });
  const service = new CatalogService();
  const expected = { versions: ['1.21.10', '1.21.1', '1.20.6'] };
  assert.deepEqual(await service.getPaperVersions(), expected);
  assert.deepEqual(await service.getPaperVersions(), expected);
  assert.equal(calls, 1);
});

test('Paper rejects malformed version groups instead of serving a broken catalogue', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ versions: { '1.21': [null] } }));
  await assert.rejects(new PaperService().getVersions(), /Versionsliste/);
});

test('Paper v3 builds retain stable channel, timestamp and verified download', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    assert.equal(url, `${PAPER_PROJECT_URL}/versions/1.21.10/builds`);
    return Response.json([build(8), build(10, 'ALPHA'), build(9)]);
  });
  const result = await new PaperService().getBuilds('1.21.10');
  assert.deepEqual(result.builds.map((b) => b.build), [10, 9, 8]);
  assert.equal(result.builds[1].download?.sha256, checksum);
  assert.equal(result.builds[1].channel, 'STABLE');
});

test('Paper does not retry HTTP 403 or conceal the upstream status', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
  await assert.rejects(new PaperService().getVersions(), /HTTP 403/);
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('Paper retries transient upstream failures', async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, 'fetch', async () => ++attempts === 1
    ? new Response(null, { status: 503 }) : Response.json({ versions: { '1.21': ['1.21.10'] } }));
  assert.deepEqual(await new PaperService().getVersions(), { versions: ['1.21.10'] });
  assert.equal(attempts, 2);
});

test('Paper downloader chooses the newest stable build and verifies the v3 checksum', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-download-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.endsWith('/builds')) return Response.json([build(11, 'ALPHA'), build(9), build(10)]);
    assert.ok(url.endsWith('/paper-10.jar'));
    return new Response(jar);
  });
  const dest = path.join(dir, 'server.jar');
  await new DownloadService().downloadPaperServerJar('1.21.10', dest);
  assert.deepEqual(await fs.readFile(dest), jar);
});

test('Paper checksum mismatch deletes the untrusted download', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'paper-checksum-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  t.mock.method(globalThis, 'fetch', async (url: string) => url.endsWith('/builds')
    ? Response.json([build(10)]) : new Response('corrupted'));
  const dest = path.join(dir, 'server.jar');
  await assert.rejects(new DownloadService().downloadPaperServerJar('1.21.10', dest), /SHA256 mismatch/);
  await assert.rejects(fs.access(dest));
});

test('Paper never silently installs an experimental build or an unverifiable JAR', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json([build(10, 'ALPHA')]));
  await assert.rejects(new DownloadService().downloadPaperServerJar('1.21.10', '/unused/server.jar'), /kein stabiler/);
  fetchMock.mock.mockImplementation(async () => Response.json([build(10, 'STABLE', '')]));
  await assert.rejects(new DownloadService().downloadPaperServerJar('1.21.10', '/unused/server.jar'), /Verifizierter/);
  assert.equal(fetchMock.mock.callCount(), 2);
});

test('Paper catalogue route returns actionable JSON on upstream failure', async (t) => {
  const nativeFetch = globalThis.fetch;
  const app = express();
  app.use(catalogRouter);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await new Promise<void>((resolve) => server.on('listening', resolve));
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
  const address = server.address() as { port: number };
  const response = await nativeFetch(`http://127.0.0.1:${address.port}/paper/versions`);
  assert.equal(response.status, 502);
  const result = await response.json() as { error: string; message: string };
  assert.equal(result.error, 'PAPER_CATALOG_UNAVAILABLE');
  assert.match(result.message, /erneut versuchen/);
});

test('Paper catalogue HTTP endpoints adapt v3 versions and expose only stable builds', async (t) => {
  const nativeFetch = globalThis.fetch;
  const app = express();
  app.use(catalogRouter);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await new Promise<void>((resolve) => server.on('listening', resolve));
  t.mock.method(globalThis, 'fetch', async (url: string) => url.endsWith('/builds')
    ? Response.json([build(20, 'ALPHA'), build(19)])
    : Response.json({ versions: { '1.21': ['1.21.10'] } }));
  const { port } = server.address() as { port: number };
  const versions = await nativeFetch(`http://127.0.0.1:${port}/paper/versions`);
  assert.equal(versions.status, 200);
  assert.deepEqual(await versions.json(), { versions: ['1.21.10'] });
  const builds = await nativeFetch(`http://127.0.0.1:${port}/paper/builds/1.21.10`);
  assert.equal(builds.status, 200);
  assert.deepEqual(await builds.json(), {
    version: '1.21.10', hasStable: true,
    builds: [{ id: 19, channel: 'STABLE', time: '2026-01-01T00:00:00Z' }],
  });
});
