// Voice dictation for the composer.
//
// The browser Speech Recognition API (webkitSpeechRecognition) does NOT work in
// Electron — it depends on a Google speech backend that only ships in official
// Chrome — so the old implementation appeared to start then silently did
// nothing. Instead we record the microphone as WAV in the renderer and send it
// to the main process, which transcribes it with a Gemini model (see
// main/chat.ts transcribeAudio). This actually works with the user's own key.
import { useRef, useState } from 'react'

export type DictationState = 'idle' | 'recording' | 'transcribing'

interface Recorder {
  stream: MediaStream
  ctx: AudioContext
  source: MediaStreamAudioSourceNode
  processor: ScriptProcessorNode
  mute: GainNode
  chunks: Float32Array[]
}

const TARGET_RATE = 16000 // 16 kHz mono is plenty for speech and keeps files small

function flatten(chunks: Float32Array[]): Float32Array {
  const len = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Float32Array(len)
  let o = 0
  for (const c of chunks) {
    out.set(c, o)
    o += c.length
  }
  return out
}

/** Average-downsample float PCM to a lower sample rate. */
function downsample(buf: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return buf
  const ratio = from / to
  const newLen = Math.round(buf.length / ratio)
  const out = new Float32Array(newLen)
  let pos = 0
  for (let i = 0; i < newLen; i++) {
    const next = Math.round((i + 1) * ratio)
    let sum = 0
    let cnt = 0
    for (let j = pos; j < next && j < buf.length; j++) {
      sum += buf[j]
      cnt++
    }
    out[i] = cnt ? sum / cnt : 0
    pos = next
  }
  return out
}

/** Encode mono float PCM as a 16-bit WAV data URL. */
function encodeWavDataUrl(samples: Float32Array, sampleRate: number): string {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  let off = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true)
    off += 2
  }
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return 'data:audio/wav;base64,' + btoa(binary)
}

export function useDictation(onText: (text: string) => void): {
  state: DictationState
  toggle: () => void
} {
  const [state, setState] = useState<DictationState>('idle')
  const ref = useRef<Recorder | null>(null)

  const teardown = (): void => {
    const r = ref.current
    if (!r) return
    try {
      r.processor.disconnect()
      r.source.disconnect()
      r.mute.disconnect()
    } catch {
      /* ignore */
    }
    r.stream.getTracks().forEach((t) => t.stop())
    r.ctx.close().catch(() => {})
    ref.current = null
  }

  const stop = async (): Promise<void> => {
    const r = ref.current
    if (!r) {
      setState('idle')
      return
    }
    const chunks = r.chunks
    const rate = r.ctx.sampleRate
    teardown()
    const flat = flatten(chunks)
    if (flat.length < rate * 0.3) {
      // less than ~0.3s captured — nothing worth transcribing
      setState('idle')
      return
    }
    setState('transcribing')
    try {
      const wav = encodeWavDataUrl(downsample(flat, rate, TARGET_RATE), TARGET_RATE)
      const res = await window.api.chat.transcribe(wav)
      if (res.text) onText(res.text)
      else if (res.error) alert(`Dictation failed: ${res.error}`)
    } catch {
      alert('Dictation failed while transcribing the audio.')
    }
    setState('idle')
  }

  const toggle = (): void => {
    if (state === 'transcribing') return
    if (state === 'recording') {
      void stop()
      return
    }
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Ctx: typeof AudioContext = window.AudioContext || (window as any).webkitAudioContext
        const ctx = new Ctx()
        const source = ctx.createMediaStreamSource(stream)
        const processor = ctx.createScriptProcessor(4096, 1, 1)
        const mute = ctx.createGain()
        mute.gain.value = 0 // route to destination silently so no mic feedback
        const chunks: Float32Array[] = []
        processor.onaudioprocess = (e) => {
          chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)))
        }
        source.connect(processor)
        processor.connect(mute)
        mute.connect(ctx.destination)
        ref.current = { stream, ctx, source, processor, mute, chunks }
        setState('recording')
      } catch {
        alert('Could not access the microphone. Please allow microphone access and try again.')
        setState('idle')
      }
    })()
  }

  return { state, toggle }
}
