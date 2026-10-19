import { decide } from '../ai/ai'
import { FACTION_SETUPS } from './data'
import { applyAction, getDecisions, startGame } from './engine'
import type { GameConfig, GameState } from './types'
import { viewFor } from './view'

/** 檢查 81 張牌都還在，且沒有重複 */
export function checkInvariants(s: GameState) {
  const all: number[] = [...s.deck, ...s.discard]
  for (const p of s.players) all.push(...p.hand, ...p.intel)
  if (s.trans && s.trans.obtainedBy == null) all.push(s.trans.card)
  for (const it of s.stack) all.push(it.card)
  // 真偽莫辨翻出、還沒被選走的牌
  const seen = new Set<unknown>()
  for (const item of s.q) {
    const cards = item.data.cards
    if (Array.isArray(cards) && !seen.has(cards)) {
      seen.add(cards)
      all.push(...(cards as number[]))
    }
  }
  const set = new Set(all)
  if (all.length !== 81 || set.size !== 81) {
    throw new Error(`卡牌數量錯誤：${all.length} 張，不重複 ${set.size} 張（回合 ${s.turnNo}）`)
  }
  // 技能／死亡流程進行中時，暫時不檢查狀態
  if (s.q.length || s.result) return
  for (const p of s.players) {
    if (p.status !== 'alive' && (p.hand.length || p.intel.length)) throw new Error(`${p.name} 已出局卻還有牌`)
    if (p.status === 'alive' && p.intel.filter((id) => s.cards[id].colour === 'black').length >= 3)
      throw new Error(`${p.name} 有三張假情報卻還活著`)
  }
}

export function makeConfig(n: number, seed: number, setupIdx = 0, alliance = false): GameConfig {
  const setups = FACTION_SETUPS[n]
  return {
    players: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `玩家${i + 1}`, isAI: true })),
    factions: setups[setupIdx % setups.length],
    neutralAlliance: alliance,
    seed,
  }
}

/** 統計：各技能／問題被觸發幾次 */
export const skillStats: Record<string, number> = {}

export function playOut(config: GameConfig, maxActions = 20000) {
  let s = startGame(config)
  let actions = 0
  while (!s.result) {
    const decs = getDecisions(s)
    if (decs.length === 0) throw new Error(`遊戲卡住：沒有任何待決定事項（phase=${s.phase}）`)
    const d = decs[0]
    const a = decide(viewFor(s, d.player))
    if (d.type === 'ask') skillStats[`問：${d.ask.title}`] = (skillStats[`問：${d.ask.title}`] ?? 0) + 1
    if (a.type === 'use_skill') skillStats[`發動：${a.skill}`] = (skillStats[`發動：${a.skill}`] ?? 0) + 1
    if (a.type === 'play_card' && a.as) skillStats[`當作：${a.as}`] = (skillStats[`當作：${a.as}`] ?? 0) + 1
    s = applyAction(s, d.player, a)
    if (s.phase !== 'choose_character') checkInvariants(s)
    if (++actions > maxActions) throw new Error('動作數過多，可能卡在迴圈')
  }
  return { state: s, actions }
}
