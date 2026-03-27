type SanitizeOptions = {
  maxDepth?: number
}

const DEFAULT_MAX_DEPTH = 6

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const shouldRedactKey = (key: string) => {
  const normalized = key.toLowerCase()
  return (
    normalized.includes('token') ||
    normalized.includes('authorization') ||
    normalized.includes('cookie') ||
    normalized.includes('secret') ||
    normalized.includes('password')
  )
}

const sanitizeValue = (value: unknown, depth: number, maxDepth: number): unknown => {
  if (depth > maxDepth) return '[Truncated]'
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, depth + 1, maxDepth))
  }
  if (isRecord(value)) {
    return sanitizeLogPayload(value, { maxDepth }, depth + 1)
  }
  return value
}

export const sanitizeLogPayload = (
  value: unknown,
  options: SanitizeOptions = {},
  depth = 0,
): unknown => {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH
  if (depth > maxDepth) return '[Truncated]'
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, depth + 1, maxDepth))
  }
  if (!isRecord(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      shouldRedactKey(key) ? '[REDACTED]' : sanitizeValue(entry, depth + 1, maxDepth),
    ]),
  )
}
