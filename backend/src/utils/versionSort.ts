export const compareVersionsDesc = (a: string, b: string): number =>
  b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });

export const sortVersionsDesc = (versions: string[]): string[] => versions.slice().sort(compareVersionsDesc);
