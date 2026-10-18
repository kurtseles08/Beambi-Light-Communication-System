import { useCallback, useEffect, useRef, useState } from 'react'

// Minimal types for the browser speech API (not in TypeScript's DOM lib)
type RecResult = { isFinal: boolean; 0: { transcript: string } }
type RecEvent = { resultIndex: number; results: ArrayLike<RecResult> }
interface Rec {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: RecEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
type RecCtor = new () => Rec

const getCtor = (): RecCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecCtor; webkitSpeechRecognition?: RecCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const speechSupported = () => getCtor() !== null

// Listens to the laptop microphone. Calls onFinal once per finished sentence.
export function useSpeech(onFinal: (text: string, durationMs: number) => void, lang = 'en-US') {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<Rec | null>(null)
  const wantRef = useRef(false)
  const startedRef = useRef<number | null>(null)
  const cbRef = useRef(onFinal)

  useEffect(() => {
    cbRef.current = onFinal
  })

  const stop = useCallback(() => {
    wantRef.current = false
    recRef.current?.stop()
    setInterim('')
  }, [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) {
      setError('This browser has no speech recognition. Use Chrome or Edge, or type the message.')
      return
    }
    setError(null)
    const rec = new Ctor()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true

    rec.onresult = (e) => {
      let live = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const t = r[0].transcript.trim()
        if (startedRef.current === null && t) startedRef.current = Date.now()
        if (r.isFinal) {
          if (t) cbRef.current(t, Date.now() - (startedRef.current ?? Date.now()))
          startedRef.current = null
        } else {
          live += t + ' '
        }
      }
      setInterim(live.trim())
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        wantRef.current = false
        setError('Microphone blocked. Allow the microphone for this page (use http://localhost).')
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        setError(`Speech recognition error: ${e.error}`)
      }
    }
    // Chrome stops after a pause in speech, so restart while the user wants to keep listening
    rec.onend = () => {
      if (wantRef.current) {
        try { rec.start() } catch { /* already starting */ }
      } else {
        setListening(false)
        setInterim('')
      }
    }

    recRef.current = rec
    wantRef.current = true
    try {
      rec.start()
      setListening(true)
    } catch {
      setError('Could not start the microphone.')
    }
  }, [lang])

  useEffect(() => () => {
    wantRef.current = false
    recRef.current?.stop()
  }, [])

  return { listening, interim, error, start, stop }
}