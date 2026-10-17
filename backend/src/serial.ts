import { SerialPort, ReadlineParser } from 'serialport'

export type DeviceBridge = {
  send: (o: object) => boolean
  isOpen: () => boolean
}

type Opts = {
  path: string
  baudRate: number
  onLine: (o: Record<string, unknown>) => void
  onConnection: (connected: boolean) => void
}

// Opens the USB serial port, reads one JSON object per line, and reconnects every 2 s if it drops.
export function createSerialBridge({ path, baudRate, onLine, onConnection }: Opts): DeviceBridge {
  let port: SerialPort | null = null
  let retry: NodeJS.Timeout | null = null
  let connected = false

  // Only report real changes, so a failed retry every 2 s does not spam "Device disconnected".
  const setConn = (c: boolean) => {
    if (c !== connected) {
      connected = c
      onConnection(c)
    }
  }

  const scheduleRetry = () => {
    if (retry) return
    retry = setTimeout(() => { retry = null; open() }, 2000)
  }

  function open() {
    const p = new SerialPort({ path, baudRate, autoOpen: false, hupcl: false })
    const parser = p.pipe(new ReadlineParser({ delimiter: '\n' }))
    parser.on('data', (raw: string) => {
      const line = raw.trim()
      if (!line.startsWith('{')) return            // '#' debug text and boot noise are ignored
      try { onLine(JSON.parse(line)) } catch { /* partial line: skip */ }
    })
    p.on('close', () => {
      if (port === p) port = null
      setConn(false)
      scheduleRetry()
    })
    p.on('error', (e) => console.error('[serial]', e.message))
    p.open((err) => {
      if (err) {
        console.error('[serial] cannot open', path, '-', err.message)
        setConn(false)
        scheduleRetry()
        return
      }
      port = p
      console.log('[serial] connected', path)
      setConn(true)
    })
  }

  open()
  return {
    send: (o) => {
      if (!port?.isOpen) return false
      port.write(JSON.stringify(o) + '\n')
      return true
    },
    isOpen: () => !!port?.isOpen,
  }
}