// 對本機伺服器（wrangler dev）做一次完整對局：兩個真人客戶端用 AI 幫他們出手，另外電腦補位
// 用法：npx tsx scripts/server-smoke.ts [http://127.0.0.1:8787]
import { decide } from '../src/ai/ai'
import type { ChatMsg, GamePacket, RoomInfo, ToClient, ToServer } from '../src/shared/protocol'

const BASE = process.argv[2] ?? 'http://127.0.0.1:8787'
const WS = BASE.replace(/^http/, 'ws')

class Bot {
  ws!: WebSocket
  room: RoomInfo | null = null
  game: GamePacket | null = null
  chat: ChatMsg[] = []
  rejected: string | null = null
  acted = 0
  lastKey = ''
  constructor(
    readonly name: string,
    readonly clientId: string,
  ) {}
  connect(code: string, create = false) {
    return new Promise<void>((resolve) => {
      this.ws = new WebSocket(`${WS}/ws/${code}${create ? '?create=1' : ''}`)
      this.ws.onopen = () => {
        this.send({ t: 'hello', clientId: this.clientId, name: this.name })
        resolve()
      }
      this.ws.onmessage = (e) => this.on(JSON.parse(String(e.data)) as ToClient)
    })
  }
  send(m: ToServer) {
    this.ws.send(JSON.stringify(m))
  }
  on(m: ToClient) {
    if (m.t === 'room') this.room = m.room
    if (m.t === 'game') {
      this.game = m.game
      this.maybeAct()
    }
    if (m.t === 'chat') this.chat = m.replace ? m.msgs : [...this.chat, ...m.msgs]
    if (m.t === 'rejected') this.rejected = m.reason
    if (m.t === 'error') console.log(`[${this.name}] 錯誤：${m.msg}`)
  }
  maybeAct() {
    const v = this.game?.view
    if (!v?.decision || v.result) return
    const key = `${v.log.length}-${JSON.stringify(v.decision)}`
    if (key === this.lastKey) return
    this.lastKey = key
    setTimeout(() => {
      if (this.game?.view !== v) return
      this.acted++
      this.send({ t: 'action', action: decide(v) })
    }, 30)
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(f: () => boolean, ms: number, what: string) {
  const t0 = Date.now()
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error(`逾時：${what}`)
    await wait(50)
  }
}

const { code } = (await (await fetch(`${BASE}/api/new`)).json()) as { code: string }
console.log('房號', code)

// 不存在的房間會被拒絕
const ghost = new Bot('路人', 'ghost')
await ghost.connect('ZZZZZ')
await until(() => !!ghost.rejected, 5000, '拒絕不存在的房間')
console.log('不存在的房間：', ghost.rejected)

const a = new Bot('房主', 'client-a')
const b = new Bot('小明', 'client-b')
await a.connect(code, true)
await b.connect(code)
await until(() => a.room?.members.length === 2, 5000, '兩人進房')
console.log('房主是', a.room!.ownerId === 'client-a' ? '房主' : '?', '｜成員', a.room!.members.map((m) => m.name))

a.send({ t: 'chat', text: '哈囉' })
await until(() => b.chat.some((c) => c.text === '哈囉'), 5000, '聊天')
console.log('聊天 OK')

// 非房主不能改設定
b.send({ t: 'settings', patch: { count: 9 } })
await wait(200)
a.send({ t: 'settings', patch: { count: 4 } })
await until(() => a.room?.settings.count === 4, 5000, '改人數')
console.log('人數', a.room!.settings.count)

a.send({ t: 'start' })
await until(() => !!a.game && !!b.game, 5000, '開始遊戲')
console.log('遊戲開始；a 座位', a.game!.view.me, 'b 座位', b.game!.view.me)

// 對局中 b 斷線再重連
await until(() => (a.game?.view.turnNo ?? 0) >= 3, 120000, '打到第 3 回合')
b.ws.close()
await wait(500)
const b2 = new Bot('小明', 'client-b')
await b2.connect(code)
await until(() => !!b2.game, 5000, '重連拿回遊戲')
console.log('b 重連後座位', b2.game!.view.me, '手牌', b2.game!.view.hand.length)

await until(() => !!a.game?.view.result, 300000, '遊戲結束')
console.log('結果：', a.game!.view.result!.reason, '｜回合', a.game!.view.turnNo, '｜a 出手', a.acted, 'b 出手', b.acted + b2.acted)

// 看不到別人的手牌與身份
const others = a.game!.view.players.filter((p) => p.seat !== a.game!.view.me)
console.log('結束後公開身份：', others.every((p) => p.faction !== null))

a.send({ t: 'backToRoom' })
await until(() => a.room?.started === false, 5000, '回到房間')
console.log('回到房間 OK')
a.ws.close()
b2.ws.close()
process.exit(0)
