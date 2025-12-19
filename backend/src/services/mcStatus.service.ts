import net from 'net'

const encodeVarInt = (value: number): Buffer => {
  const bytes: number[] = []
  let remaining = value
  do {
    let temp = remaining & 0x7f
    remaining >>>= 7
    if (remaining !== 0) {
      temp |= 0x80
    }
    bytes.push(temp)
  } while (remaining !== 0)
  return Buffer.from(bytes)
}

const readVarInt = (buffer: Buffer, offset = 0): { value: number; size: number } | null => {
  let numRead = 0
  let result = 0
  let read = 0

  do {
    if (offset + numRead >= buffer.length) return null
    read = buffer[offset + numRead]
    const value = read & 0x7f
    result |= value << (7 * numRead)
    numRead += 1
    if (numRead > 5) return null
  } while (read & 0x80)

  return { value: result, size: numRead }
}

const buildHandshakePacket = (host: string, port: number) => {
  const protocolVersion = 763 // Accepts modern versions while remaining compatible with status ping
  const hostBuffer = Buffer.from(host, 'utf8')
  const portBuffer = Buffer.alloc(2)
  portBuffer.writeUInt16BE(port, 0)
  const payload = Buffer.concat([
    Buffer.from([0x00]),
    encodeVarInt(protocolVersion),
    encodeVarInt(hostBuffer.length),
    hostBuffer,
    portBuffer,
    Buffer.from([0x01]),
  ])
  const length = encodeVarInt(payload.length)
  return Buffer.concat([length, payload])
}

const buildStatusRequestPacket = () => Buffer.from([0x01, 0x00])

export interface MinecraftStatusResult {
  online: number | null
  max: number | null
  latencyMs: number | null
  sample?: { name: string; id?: string }[]
}

const tryParseStatus = (buffer: Buffer): MinecraftStatusResult | null => {
  const lengthInfo = readVarInt(buffer, 0)
  if (!lengthInfo) return null

  const totalLength = lengthInfo.value
  if (buffer.length < lengthInfo.size + totalLength) return null

  const packet = buffer.subarray(lengthInfo.size, lengthInfo.size + totalLength)
  const packetId = readVarInt(packet, 0)
  if (!packetId || packetId.value !== 0) return null

  const jsonLength = readVarInt(packet, packetId.size)
  if (!jsonLength) return null

  const start = packetId.size + jsonLength.size
  const end = start + jsonLength.value
  if (packet.length < end) return null

  const json = packet.toString('utf8', start, end)
  try {
    const parsed = JSON.parse(json) as {
      players?: { online?: number; max?: number; sample?: { name: string; id?: string }[] }
    }
    return {
      online: typeof parsed?.players?.online === 'number' ? parsed.players.online : null,
      max: typeof parsed?.players?.max === 'number' ? parsed.players.max : null,
      latencyMs: null,
      sample: parsed?.players?.sample,
    }
  } catch (error) {
    console.error('Failed to parse status response', error)
    return null
  }
}

export const queryMinecraftStatus = async (
  host: string,
  port: number,
  timeoutMs = 4000,
): Promise<MinecraftStatusResult> => {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    let buffer = Buffer.alloc(0)
    let settled = false
    const start = Date.now()

    const finalize = (error?: Error, result?: MinecraftStatusResult) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) {
        reject(error)
      } else if (result) {
        resolve({ ...result, latencyMs: result.latencyMs ?? Date.now() - start })
      } else {
        reject(new Error('No status response'))
      }
    }

    socket.setTimeout(timeoutMs, () => finalize(new Error('Ping timeout')))
    socket.on('error', (err) => finalize(err))
    socket.on('close', () => finalize(new Error('Connection closed before status')))

    socket.on('connect', () => {
      try {
        socket.write(buildHandshakePacket(host, port))
        socket.write(buildStatusRequestPacket())
      } catch (error) {
        finalize(error instanceof Error ? error : new Error('Failed to send handshake'))
      }
    })

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk])
      const parsed = tryParseStatus(buffer)
      if (parsed) {
        finalize(undefined, parsed)
      }
    })
  })
}
