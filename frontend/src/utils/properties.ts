export type PropertyLine =
  | { type: 'comment'; raw: string }
  | { type: 'blank'; raw: string }
  | { type: 'kv'; key: string; value: string; raw: string }

export type ParsedProperties = {
  props: Record<string, string>
  lines: PropertyLine[]
}

const normalizeNewlines = (input: string) => input.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const parseKeyValue = (line: string): { key: string; value: string } | null => {
  const trimmed = line.trim()

  if (trimmed.length === 0 || trimmed.startsWith('#')) return null

  const separatorIndex = trimmed.indexOf('=')
  if (separatorIndex === -1) return null

  const key = trimmed.substring(0, separatorIndex).trim()
  const value = trimmed.substring(separatorIndex + 1)

  if (!key) return null
  return { key, value }
}

export const parseProperties = (raw: string): ParsedProperties => {
  const lines: PropertyLine[] = []
  const props: Record<string, string> = {}

  const splitted = normalizeNewlines(raw).split('\n')

  for (const line of splitted) {
    if (line.trim().length === 0) {
      lines.push({ type: 'blank', raw: line })
      continue
    }

    if (line.trim().startsWith('#')) {
      lines.push({ type: 'comment', raw: line })
      continue
    }

    const kv = parseKeyValue(line)
    if (kv) {
      props[kv.key] = kv.value
      lines.push({ type: 'kv', key: kv.key, value: kv.value, raw: line })
    } else {
      // Preserve unknown formats as comments to avoid data loss
      lines.push({ type: 'comment', raw: line })
    }
  }

  return { props, lines }
}

export const applyProperties = (
  raw: string,
  set: Record<string, string>,
  unset: string[] = [],
): string => {
  const { lines } = parseProperties(raw)
  const setEntries = new Map<string, string>(Object.entries(set ?? {}).map(([k, v]) => [k, String(v)]))
  const unsetKeys = new Set(unset ?? [])

  const outputLines: string[] = []

  for (const line of lines) {
    if (line.type !== 'kv') {
      outputLines.push(line.raw)
      continue
    }

    if (unsetKeys.has(line.key)) {
      continue
    }

    if (setEntries.has(line.key)) {
      const newValue = setEntries.get(line.key) ?? ''
      outputLines.push(`${line.key}=${newValue}`)
      setEntries.delete(line.key)
    } else {
      outputLines.push(line.raw.trim().length > 0 ? `${line.key}=${line.value}` : line.raw)
    }
  }

  for (const [key, value] of setEntries.entries()) {
    outputLines.push(`${key}=${value}`)
  }

  return `${outputLines.join('\n')}${outputLines.length > 0 ? '\n' : ''}`
}
