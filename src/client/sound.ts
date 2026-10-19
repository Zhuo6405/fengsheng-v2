/** 用 Web Audio 即時合成的音效：不需要任何音檔 */

export type Sfx =
  | 'myTurn' // 輪到你出牌
  | 'prompt' // 需要你回應
  | 'turn' // 換人的回合
  | 'card' // 有人打出功能牌
  | 'send' // 傳出情報
  | 'hop' // 情報傳到下一人
  | 'stampRed'
  | 'stampBlue'
  | 'stampBlack'
  | 'counter' // 識破
  | 'death'
  | 'win'
  | 'lose'
  | 'chat'
  | 'click'

const KEY = 'fs2-sound'
let ctx: AudioContext | null = null
let master: GainNode | null = null
let enabled = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
})()
const listeners = new Set<() => void>()

export const soundOn = () => enabled
export function setSoundOn(on: boolean) {
  enabled = on
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    /* 無痕模式等情況忽略 */
  }
  if (on) unlock()
  listeners.forEach((f) => f())
}
export function onSoundChange(f: () => void) {
  listeners.add(f)
  return () => void listeners.delete(f)
}

/** 瀏覽器規定要使用者互動後才能出聲，所以第一次點擊時建立/喚醒 AudioContext */
function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!AC) return
      ctx = new AC()
      master = ctx.createGain()
      master.gain.value = 0.55
      master.connect(ctx.destination)
    }
    if (ctx.state === 'suspended') void ctx.resume()
  } catch {
    ctx = null
  }
}
if (typeof window !== 'undefined') {
  const first = () => unlock()
  window.addEventListener('pointerdown', first, { capture: true })
  window.addEventListener('keydown', first, { capture: true })
}

function tone(freq: number, at: number, dur: number, opts: { type?: OscillatorType; vol?: number; slide?: number; attack?: number } = {}) {
  if (!ctx || !master) return
  const o = ctx.createOscillator()
  const g = ctx.createGain()
  o.type = opts.type ?? 'sine'
  o.frequency.setValueAtTime(freq, at)
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), at + dur)
  const v = opts.vol ?? 0.3
  const a = opts.attack ?? 0.005
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(v, at + a)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  o.connect(g).connect(master)
  o.start(at)
  o.stop(at + dur + 0.02)
}

function noise(at: number, dur: number, opts: { vol?: number; from?: number; to?: number; q?: number; type?: BiquadFilterType } = {}) {
  if (!ctx || !master) return
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur))
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = ctx.createBufferSource()
  src.buffer = buf
  const f = ctx.createBiquadFilter()
  f.type = opts.type ?? 'bandpass'
  f.Q.value = opts.q ?? 1
  f.frequency.setValueAtTime(opts.from ?? 1200, at)
  if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, at + dur)
  const g = ctx.createGain()
  const v = opts.vol ?? 0.3
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(v, at + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  src.connect(f).connect(g).connect(master)
  src.start(at)
  src.stop(at + dur + 0.02)
}

function stamp(t: number, pitch: number) {
  noise(t, 0.12, { vol: 0.5, from: 300, to: 120, type: 'lowpass' })
  tone(pitch, t, 0.22, { type: 'triangle', vol: 0.35, slide: 0.6 })
  noise(t + 0.01, 0.05, { vol: 0.15, from: 2500, q: 0.7 })
}

let lastAt: Partial<Record<Sfx, number>> = {}

export function play(s: Sfx) {
  if (!enabled) return
  unlock()
  if (!ctx || ctx.state !== 'running') return
  // 同一種音效 80ms 內只播一次，避免 AI 連續動作時疊在一起
  const now = performance.now()
  if ((lastAt[s] ?? 0) > now - 80) return
  lastAt = { ...lastAt, [s]: now }
  const t = ctx.currentTime + 0.01
  switch (s) {
    case 'myTurn':
      tone(660, t, 0.5, { type: 'triangle', vol: 0.25 })
      tone(880, t + 0.12, 0.6, { type: 'triangle', vol: 0.22 })
      tone(1320, t + 0.24, 0.7, { type: 'sine', vol: 0.12 })
      break
    case 'prompt':
      tone(988, t, 0.25, { type: 'sine', vol: 0.18 })
      tone(1318, t + 0.08, 0.3, { type: 'sine', vol: 0.12 })
      break
    case 'turn':
      tone(523, t, 0.6, { type: 'sine', vol: 0.12 })
      tone(1046, t, 0.4, { type: 'sine', vol: 0.05 })
      break
    case 'card':
      noise(t, 0.09, { vol: 0.4, from: 2200, to: 900, q: 0.8 })
      tone(180, t, 0.08, { type: 'triangle', vol: 0.15, slide: 0.7 })
      break
    case 'send':
      noise(t, 0.35, { vol: 0.28, from: 600, to: 3200, q: 1.2 })
      tone(440, t + 0.05, 0.25, { type: 'sine', vol: 0.06, slide: 1.5 })
      break
    case 'hop':
      noise(t, 0.12, { vol: 0.18, from: 1500, to: 2600, q: 1.5 })
      break
    case 'stampRed':
      stamp(t, 150)
      break
    case 'stampBlue':
      stamp(t, 190)
      break
    case 'stampBlack':
      stamp(t, 95)
      tone(70, t + 0.05, 0.4, { type: 'sawtooth', vol: 0.06, slide: 0.8 })
      break
    case 'counter':
      tone(1400, t, 0.12, { type: 'square', vol: 0.08, slide: 0.5 })
      noise(t, 0.15, { vol: 0.25, from: 4000, to: 1500, q: 2 })
      break
    case 'death':
      tone(110, t, 1.4, { type: 'sawtooth', vol: 0.12, slide: 0.5, attack: 0.05 })
      tone(82, t + 0.1, 1.5, { type: 'sine', vol: 0.25, slide: 0.6, attack: 0.05 })
      break
    case 'win':
      ;[523, 659, 784, 1046].forEach((f, i) => tone(f, t + i * 0.13, 0.7, { type: 'triangle', vol: 0.2 }))
      break
    case 'lose':
      ;[392, 330, 262].forEach((f, i) => tone(f, t + i * 0.22, 0.8, { type: 'triangle', vol: 0.18 }))
      break
    case 'chat':
      tone(1200, t, 0.08, { type: 'sine', vol: 0.12, slide: 1.4 })
      break
    case 'click':
      noise(t, 0.03, { vol: 0.12, from: 3000, q: 1 })
      break
  }
}
