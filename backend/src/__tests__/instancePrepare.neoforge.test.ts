import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveNeoForgeVersionOrThrow, resolveRequestedLoaderVersion } from '../api/instancePrepare';

test('resolveRequestedLoaderVersion prefers neoforgeVersion for neoforge', () => {
  const resolved = resolveRequestedLoaderVersion({
    serverType: 'neoforge',
    neoforgeVersion: '21.1.219',
    loaderVersion: '26.1.1-beta',
    loader: { type: 'forge', version: '26.1.1-beta' },
  });

  assert.equal(resolved, '21.1.219');
});

test('resolveNeoForgeVersionOrThrow returns exact selected version when available', () => {
  const available = ['21.1.119', '21.1.219', '26.1.1-beta'];
  const resolved = resolveNeoForgeVersionOrThrow('21.1.219', available);

  assert.equal(resolved, '21.1.219');
});

test('resolveNeoForgeVersionOrThrow rejects unknown version instead of falling back to first entry', () => {
  const available = ['26.1.1-beta', '21.1.219'];

  assert.throws(
    () => resolveNeoForgeVersionOrThrow('21.1.999', available),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      String(error.message).includes('NeoForge loader version 21.1.999 is not available'),
  );
});

test('resolveNeoForgeVersionOrThrow rejects missing neoforge version', () => {
  const available = ['26.1.1-beta', '21.1.219'];

  assert.throws(
    () => resolveNeoForgeVersionOrThrow(undefined, available),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      String(error.message).includes('NeoForge loader version is required'),
  );
});
