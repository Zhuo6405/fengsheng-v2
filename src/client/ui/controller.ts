import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { Action, GameConfig } from '../../engine/types'
import type { GameView } from '../../engine/view'
import { viewFor } from '../../engine/view'
import type { ChatMsg, RoomInfo } from '../../shared/protocol'
import { GameRunner } from '../../shared/runner'
import type { VoiceMesh } from '../net/voice'

/** 牌桌畫面需要的一切：單機、房主、玩家都提供同一個介面 */
export interface GameController {
  view: GameView
  act: (a: Action) => void
  error: string | null
  clearError: () => void
  waitingOn: number[]
  deadline: number | null
  aiControlled: number[]
}

/** 連線模式才有的：聊天、語音、房間資訊 */
export interface Social {
  me: string
  room: RoomInfo
  chat: ChatMsg[]
  say: (text: string) => void
  voice: VoiceMesh | null
}

export function useStore(s: { subscribe: (fn: () => void) => () => void; version: number }) {
  return useSyncExternalStore(s.subscribe, () => s.version)
}

/** 單機：人類坐 0 號位，其他都是 AI，不限時 */
export function useLocalController(config: GameConfig): GameController {
  const [runner] = useState(() => new GameRunner(config, [0], { aiDelay: 550, timeouts: null }))
  const [, setTick] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const off = runner.subscribe(() => setTick((t) => t + 1))
    return () => {
      off()
    }
  }, [runner])
  useEffect(() => () => runner.dispose(), [runner])
  const act = useCallback((a: Action) => setError(runner.submit(0, a)), [runner])
  const state = runner.state
  const view = useMemo(() => viewFor(state, 0), [state])
  return {
    view,
    act,
    error,
    clearError: () => setError(null),
    waitingOn: runner.waitingOn(),
    deadline: null,
    aiControlled: [],
  }
}

/** 倒數秒數 */
export function useSecondsLeft(deadline: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadline) return
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [deadline])
  if (!deadline) return null
  return Math.max(0, Math.ceil((deadline - now) / 1000))
}
