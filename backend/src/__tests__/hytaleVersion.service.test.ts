import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { compareSemver, normalizeSemver, parseHytaleReleaseManifest } from '../services/hytaleVersion.service';

test('normalizeSemver strips prefixes and metadata', () => {
  assert.equal(normalizeSemver('v1.2.3'), '1.2.3');
  assert.equal(normalizeSemver('2.4.6+build.7'), '2.4.6');
  assert.equal(normalizeSemver('3.1.9-beta'), '3.1.9');
});

test('compareSemver compares version order', () => {
  assert.ok(compareSemver('1.2.3', '1.2.4') < 0);
  assert.ok(compareSemver('1.2.3', '1.2.3') === 0);
  assert.ok(compareSemver('2.0.0', '1.9.9') > 0);
});

test('parseHytaleReleaseManifest reads releases and latest', () => {
  const manifest = parseHytaleReleaseManifest({
    latest: '1.4.0',
    releases: [
      { version: '1.4.0', server: { url: 'https://example.com/hytale-1.4.0.zip', sha256: 'abc' } },
    ],
  });

  assert.equal(manifest.latest, '1.4.0');
  assert.equal(manifest.releases.length, 1);
  assert.equal(manifest.releases[0].version, '1.4.0');
  assert.equal(manifest.releases[0].serverUrl, 'https://example.com/hytale-1.4.0.zip');
});
