import path from 'path';

const DEFAULT_FILENAME = 'room.glb';

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    console.warn(`Invalid value "${value}"; using default ${fallback}`);
    return fallback;
  }
  return parsed;
}

function sanitizeFilename(name) {
  if (typeof name !== 'string') return DEFAULT_FILENAME;
  let base = path.basename(name);
  base = base
    .replace(/[\\/]/g, '')
    .replace(/[\x00-\x1f\x80-\x9f]/g, '')
    .trim();
  if (!base || base === '.' || base === '..') return DEFAULT_FILENAME;
  return base;
}

export { parsePositiveInt, sanitizeFilename, DEFAULT_FILENAME };
