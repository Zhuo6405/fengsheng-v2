import type { Action } from '../engine/types'
import type { GameView } from '../engine/view'

// 瀏覽器與雲端房間伺服器之間的 WebSocket 訊息（JSON）

export interface RoomSettings {
  /** 遊戲人數（含電腦補位） */
  count: number
  setupIdx: number
  alliance: boolean
}

export interface Member {
  clientId: string
  name: string
  connected: boolean
  seat: number | null
  inVoice: boolean
}

export interface RoomInfo {
  code: string
  ownerId: string
  members: Member[]
  settings: RoomSettings
  started: boolean
}

export interface ChatMsg {
  id: string
  clientId: string | null
  name: string
  text: string
  ts: number
  system?: boolean
}

export interface GamePacket {
  view: GameView
  waitingOn: number[]
  deadline: number | null
  /** 被 AI 代打中的座位 */
  aiControlled: number[]
  /** 每局的 id（對局紀錄用） */
  gameId: string
}

export type ToServer =
  | { t: 'hello'; clientId: string; name: string }
  | { t: 'settings'; patch: Partial<RoomSettings> }
  | { t: 'start' }
  | { t: 'backToRoom' }
  | { t: 'action'; action: Action }
  | { t: 'chat'; text: string }
  | { t: 'voice'; on: boolean }
  /** 語音的 WebRTC 信令，由伺服器轉給指定的人 */
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'ping' }

export type ToClient =
  | { t: 'room'; room: RoomInfo; you: string }
  | { t: 'game'; game: GamePacket | null }
  | { t: 'chat'; msgs: ChatMsg[]; replace?: boolean }
  | { t: 'error'; msg: string }
  | { t: 'rejected'; reason: string }
  | { t: 'rtc'; from: string; data: unknown }
  | { t: 'pong' }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function makeCode(len = 5) {
  let s = ''
  const buf = new Uint32Array(len)
  crypto.getRandomValues(buf)
  for (let i = 0; i < len; i++) s += CODE_CHARS[buf[i] % CODE_CHARS.length]
  return s
}

export function normaliseCode(s: string) {
  return s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8)
}

export const isCode = (s: string) => /^[A-Z0-9]{4,8}$/.test(s)
