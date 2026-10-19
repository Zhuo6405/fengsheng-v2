import type { Action } from '../../engine/types'
import type { ChatMsg, GamePacket, RoomInfo, RoomSettings, ToClient, ToServer } from '../../shared/protocol'

const GIVE_UP_MS = 120_000

/** 每個瀏覽器固定一個 id，斷線重連時用它認回原本的座位 */
export function clientId(): string {
  try {
    let id = localStorage.getItem('fs2-client')
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem('fs2-client', id)
    }
    return id
  } catch {
    return crypto.randomUUID()
  }
}

/** 和雲端房間伺服器的連線（自動重連） */
export class RoomSession {
  readonly me = clientId()
  code: string
  name: string
  room: RoomInfo | null = null
  game: GamePacket | null = null
  chat: ChatMsg[] = []
  status: 'connecting' | 'open' | 'reconnecting' | 'closed' = 'connecting'
  error: string | null = null
  lastError: string | null = null
  version = 0
  private ws: WebSocket | null = null
  private create: boolean
  private subs = new Set<() => void>()
  private rtcSubs = new Set<(from: string, data: unknown) => void>()
  private retry: ReturnType<typeof setTimeout> | undefined
  private ping: ReturnType<typeof setInterval> | undefined
  private lostAt: number | null = null
  private attempts = 0
  private left = false

  constructor(code: string, name: string, create: boolean) {
    this.code = code
    this.name = name
    this.create = create
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn)
    return () => {
      this.subs.delete(fn)
    }
  }

  onRtc(fn: (from: string, data: unknown) => void) {
    this.rtcSubs.add(fn)
    return () => {
      this.rtcSubs.delete(fn)
    }
  }

  private emit() {
    this.version++
    for (const fn of this.subs) fn()
  }

  get isOwner() {
    return this.room?.ownerId === this.me
  }

  connect() {
    if (this.left) return
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws/${this.code}${this.create ? '?create=1' : ''}`)
    this.ws = ws
    ws.onopen = () => {
      this.create = false // 房間建好後，重連不需要再建立
      this.status = 'open'
      this.lostAt = null
      this.attempts = 0
      this.error = null
      this.send({ t: 'hello', clientId: this.me, name: this.name })
      clearInterval(this.ping)
      this.ping = setInterval(() => this.send({ t: 'ping' }), 25_000)
      this.emit()
    }
    ws.onmessage = (e) => this.onData(JSON.parse(String(e.data)) as ToClient)
    ws.onclose = () => {
      if (this.ws === ws) this.lost()
    }
  }

  private lost() {
    clearInterval(this.ping)
    if (this.left || this.status === 'closed') return
    this.status = 'reconnecting'
    this.lostAt ??= Date.now()
    if (Date.now() - this.lostAt > GIVE_UP_MS) return this.fail('和伺服器的連線中斷了，請檢查網路後重新加入。')
    const delay = Math.min(5000, 800 * 2 ** this.attempts++)
    clearTimeout(this.retry)
    this.retry = setTimeout(() => this.connect(), delay)
    this.emit()
  }

  private fail(msg: string) {
    this.status = 'closed'
    this.error = msg
    this.left = true
    clearTimeout(this.retry)
    clearInterval(this.ping)
    this.ws?.close()
    this.emit()
  }

  private onData(msg: ToClient) {
    switch (msg.t) {
      case 'room':
        this.room = msg.room
        break
      case 'game':
        this.game = msg.game
        break
      case 'chat':
        this.chat = msg.replace ? msg.msgs : [...this.chat, ...msg.msgs].slice(-300)
        break
      case 'error':
        this.lastError = msg.msg
        break
      case 'rejected':
        return this.fail(msg.reason)
      case 'rtc':
        for (const fn of this.rtcSubs) fn(msg.from, msg.data)
        return
      case 'pong':
        return
    }
    this.emit()
  }

  private send(msg: ToServer) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  act = (a: Action) => this.send({ t: 'action', action: a })
  say = (text: string) => this.send({ t: 'chat', text })
  setVoice = (on: boolean) => this.send({ t: 'voice', on })
  rtc = (to: string, data: unknown) => this.send({ t: 'rtc', to, data })
  updateSettings = (patch: Partial<RoomSettings>) => this.send({ t: 'settings', patch })
  start = () => this.send({ t: 'start' })
  backToRoom = () => this.send({ t: 'backToRoom' })

  clearError = () => {
    this.lastError = null
    this.emit()
  }

  leave() {
    this.left = true
    clearTimeout(this.retry)
    clearInterval(this.ping)
    this.ws?.close()
  }
}
