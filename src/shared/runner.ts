import { decide } from '../ai/ai'
import { applyAction, getDecisions, RuleError, startGame } from '../engine/engine'
import type { Action, Decision, GameConfig, GameState } from '../engine/types'
import { viewFor } from '../engine/view'

export interface RunnerOpts {
  /** AI 每一步之間的延遲（毫秒），讓人看得清楚 */
  aiDelay: number
  /** 真人每種決定的時間限制；null 代表不限時（單機） */
  timeouts: Partial<Record<Decision['type'], number>> | null
}

export const ONLINE_TIMEOUTS: RunnerOpts['timeouts'] = {
  choose_character: 60_000,
  play: 90_000,
  priority: 20_000,
  accept: 30_000,
  ask: 30_000,
}

/**
 * 執行一局遊戲：持有權威狀態、排程 AI、計時真人決定。
 * 單機與房主（P2P 權威端）都用它。真人斷線時可以 setHuman(seat, false) 讓 AI 代打。
 */
export class GameRunner {
  state: GameState
  deadline: number | null = null
  private human = new Set<number>()
  private aiTimer: ReturnType<typeof setTimeout> | undefined
  private humanTimer: ReturnType<typeof setTimeout> | undefined
  private subs = new Set<() => void>()
  private disposed = false

  private opts: RunnerOpts

  constructor(config: GameConfig, humans: number[], opts: RunnerOpts, initial?: GameState) {
    this.opts = opts
    this.state = initial ?? startGame(config)
    humans.forEach((h) => this.human.add(h))
    this.schedule()
  }

  subscribe(fn: () => void) {
    this.subs.add(fn)
    return () => {
      this.subs.delete(fn)
    }
  }

  private emit() {
    for (const fn of this.subs) fn()
  }

  isHuman(seat: number) {
    return this.human.has(seat)
  }

  setHuman(seat: number, on: boolean) {
    if (on === this.human.has(seat)) return
    if (on) this.human.add(seat)
    else this.human.delete(seat)
    this.schedule()
    this.emit()
  }

  /** 真人送出動作；回傳錯誤訊息或 null */
  submit(seat: number, a: Action): string | null {
    if (this.disposed) return '遊戲已結束'
    try {
      this.state = applyAction(this.state, seat, a)
    } catch (e) {
      if (e instanceof RuleError) return e.message
      throw e
    }
    this.schedule()
    this.emit()
    return null
  }

  waitingOn(): number[] {
    return getDecisions(this.state).map((d) => d.player)
  }

  dispose() {
    this.disposed = true
    stopTimer(this.aiTimer)
    stopTimer(this.humanTimer)
    this.subs.clear()
  }

  private schedule() {
    stopTimer(this.aiTimer)
    stopTimer(this.humanTimer)
    this.deadline = null
    if (this.disposed || this.state.result) return
    const decs = getDecisions(this.state)

    const humanDecs = decs.filter((d) => this.human.has(d.player))
    if (humanDecs.length && this.opts.timeouts) {
      const ms = this.opts.timeouts[humanDecs[0].type]
      if (ms) {
        this.deadline = Date.now() + ms
        this.humanTimer = setTimeout(() => this.autoAct(), ms)
      }
    }

    // 挑角色是大家同時進行：AI 一起選完
    const aiChoose = decs.filter((d) => d.type === 'choose_character' && !this.human.has(d.player))
    if (aiChoose.length) {
      this.aiTimer = setTimeout(() => {
        for (const d of aiChoose) this.applyFor(d.player, (s) => decide(viewFor(s, d.player)))
        this.schedule()
        this.emit()
      }, 80)
      return
    }

    const d = decs[0]
    if (!d || this.human.has(d.player)) return
    const delay = d.type === 'priority' ? this.opts.aiDelay * 0.8 : this.opts.aiDelay
    this.aiTimer = setTimeout(() => {
      this.applyFor(d.player, (s) => decide(viewFor(s, d.player)))
      this.schedule()
      this.emit()
    }, delay)
  }

  /** 真人逾時：回應時機直接略過，其他交給 AI 判斷 */
  private autoAct() {
    for (const d of getDecisions(this.state).filter((x) => this.human.has(x.player))) {
      this.applyFor(d.player, (s) => (d.type === 'priority' ? { type: 'pass' } : decide(viewFor(s, d.player))))
    }
    this.schedule()
    this.emit()
  }

  private applyFor(seat: number, pick: (s: GameState) => Action) {
    if (!getDecisions(this.state).some((x) => x.player === seat)) return
    try {
      this.state = applyAction(this.state, seat, pick(this.state))
    } catch (e) {
      // AI 理論上不會出錯；萬一出錯就略過，避免整局卡住
      console.error('AI 動作失敗', e)
      try {
        this.state = applyAction(this.state, seat, { type: 'pass' })
      } catch {
        /* 無法略過的決定會在下次排程重試 */
      }
    }
  }
}

/** 兼容瀏覽器、Node 與 Workers 的計時器型別 */
function stopTimer(t: ReturnType<typeof setTimeout> | undefined) {
  if (t !== undefined) clearTimeout(t)
}
