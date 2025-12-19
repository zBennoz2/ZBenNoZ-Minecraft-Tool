import path from 'path';
import { getInstanceServerDir } from '../config/paths';

export type ResolvedInstancePath = {
  root: string;
  abs: string;
  rel: string;
};

const normalizeRelPath = (relPath: string): string => {
  if (relPath.includes('\0')) {
    throw new Error('Invalid path');
  }

  const normalized = path.posix.normalize(relPath.startsWith('/') ? relPath : `/${relPath}`);

  if (!normalized.startsWith('/')) {
    throw new Error('Invalid path');
  }

  if (normalized.includes('..')) {
    const parts = normalized.split('/');
    if (parts.some((part) => part === '..')) {
      throw new Error('Path traversal is not allowed');
    }
  }

  return normalized;
};

export const resolveInstancePath = async (instanceId: string, relPath: string): Promise<ResolvedInstancePath> => {
  const root = getInstanceServerDir(instanceId);
  const rel = normalizeRelPath(relPath);
  const abs = path.resolve(root, `.${rel}`);

  const relativeToRoot = path.relative(root, abs);
  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error('Path escapes instance server root');
  }

  // TODO: Add optional realpath check to block symlinks if required.

  return { root, abs, rel };
};
