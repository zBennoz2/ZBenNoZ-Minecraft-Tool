import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  normalizeLoaderVersionInputOrThrow,
  resolveNeoForgeVersionOrThrow,
  resolveRequestedLoaderVersion,
} from '../api/instancePrepare';

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

test('resolveRequestedLoaderVersion accepts neoforge string from UI', () => {
  const resolved = resolveRequestedLoaderVersion({
    serverType: 'neoforge',
    neoforgeVersion: '21.1.219',
  });

  assert.equal(resolved, '21.1.219');
});

test('resolveRequestedLoaderVersion accepts neoforge object {label, value} from UI', () => {
  const resolved = resolveRequestedLoaderVersion({
    serverType: 'neoforge',
    neoforgeVersion: { label: '21.1.219', value: '21.1.219' },
  });

  assert.equal(resolved, '21.1.219');
});

test('resolveRequestedLoaderVersion accepts neoforge object {version}', () => {
  const resolved = resolveRequestedLoaderVersion({
    serverType: 'neoforge',
    neoforgeVersion: { version: '21.1.219' },
  });

  assert.equal(resolved, '21.1.219');
});

test('normalizeLoaderVersionInputOrThrow throws clear error on missing mapping fields', () => {
  assert.throws(
    () => normalizeLoaderVersionInputOrThrow({ label: '21.1.219' }, 'neoforgeVersion'),
    (error: unknown) =>
      typeof error === 'object' &&
      error !== null &&
      'message' in error &&
      String(error.message).includes('neoforgeVersion must be a string or object with value/version/id'),
  );
});

test('regression: selected neoforge object value must not fail required validation', () => {
  const available = ['21.1.119', '21.1.219', '26.1.1-beta'];
  const requested = resolveRequestedLoaderVersion({
    serverType: 'neoforge',
    neoforgeVersion: { label: '21.1.219', value: '21.1.219' },
  });

  const resolved = resolveNeoForgeVersionOrThrow(requested, available);
  assert.equal(resolved, '21.1.219');
});
