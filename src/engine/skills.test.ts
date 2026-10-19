import { describe, expect, it } from 'vitest'
import { advance, applyAction, getDecisions, legalPlays, startGame } from './engine'
import { makeConfig } from './sim'
import type { GameState } from './types'

/** 指定每個座位的角色開局，回到第一位玩家的出牌階段 */
function withChars(chars: string[], seed = 3): GameState {
  let s = startGame(makeConfig(chars.length, seed))
  s.players.forEach((p, i) => (p.charOptions = [chars[i], chars[i]]))
  for (let i = 0; i < chars.length; i++) s = applyAction(s, i, { type: 'choose_character', character: chars[i] })
  s = structuredClone(s)
  // 清掉大美女抽牌後的問題，讓測試從乾淨的出牌階段開始
  s.q = []
  return s
}

const take = (s: GameState, pred: (c: GameState['cards'][number]) => boolean, n = 1) => {
  const ids = s.deck.filter((id) => pred(s.cards[id])).slice(0, n)
  s.deck = s.deck.filter((id) => !ids.includes(id))
  return ids
}

describe('角色技能', () => {
  it('禮服蒙面人可以翻開身份牌，燒掉二張假情報救女性', () => {
    const s = withChars(['mengmian', 'dameinv', 'chuzhang', 'shashou'])
    s.players[1].intel = take(s, (c) => c.colour === 'black', 3)
    advance(s)
    const d = getDecisions(s)[0]
    expect(d.type).toBe('ask')
    expect(d.player).toBe(0)
    const s2 = applyAction(s, 0, { type: 'answer', value: true })
    expect(s2.players[1].status).toBe('alive')
    expect(s2.players[1].intel.length).toBe(1)
    expect(s2.players[0].identityRevealed).toBe(true)
  })

  it('不救的話她就死亡', () => {
    const s = withChars(['mengmian', 'dameinv', 'chuzhang', 'shashou'])
    s.players[1].intel = take(s, (c) => c.colour === 'black', 3)
    advance(s)
    const s2 = applyAction(s, 0, { type: 'skip' })
    expect(s2.players[1].status).toBe('dead')
  })

  it('刀鋒的鎖定不能被識破，試探也能當鎖定', () => {
    let s = withChars(['daofeng', 'chuzhang', 'shashou', 'qibai'])
    s.active = 0
    s.phase = 'play'
    const [probe, spare] = take(s, (c) => c.kind === 'probe', 2)
    const counters = take(s, (c) => c.kind === 'counter', 3)
    s.players[0].hand = [probe, spare]
    s.players[1].hand = [counters[0]]
    s.players[2].hand = [counters[1]]
    s.players[3].hand = [counters[2]]
    const lp = legalPlays(s, 0).find((l) => l.kind === 'lock')
    expect(lp?.as).toBe(true)
    expect(lp?.uncounterable).toBe(true)
    s = applyAction(s, 0, { type: 'play_card', card: probe, target: 1, as: 'lock' })
    // 識破不能用在它身上：沒有人被詢問，鎖定直接生效
    expect(s.locks).toContain(1)
  })

  it('貝雷帽可以讓密電反方向傳', () => {
    let s = withChars(['beileimao', 'chuzhang', 'shashou', 'qibai'])
    s.active = 0
    s.phase = 'play'
    const [sec] = take(s, (c) => c.method === 'secret' && c.kind === 'decrypt')
    s.players[0].hand = [sec]
    for (const p of s.players.slice(1)) p.hand = []
    s = applyAction(s, 0, { type: 'send', card: sec, dir: -1 })
    expect(s.trans?.dir).toBe(-1)
    expect(s.trans?.holder).toBe(3)
  })

  it('老鬼被試探時強制翻開並抽二張，然後可以隱瞞身份', () => {
    let s = withChars(['chuzhang', 'laogui', 'shashou', 'qibai'])
    s.active = 0
    s.phase = 'play'
    const [probe] = take(s, (c) => c.kind === 'probe')
    s.players[0].hand = [probe]
    for (const p of s.players.slice(1)) p.hand = []
    expect(s.players[1].charFaceUp).toBe(false)
    s = applyAction(s, 0, { type: 'play_card', card: probe, target: 1 })
    expect(s.players[1].charFaceUp).toBe(true)
    expect(s.players[1].hand.length).toBe(2)
    const d = getDecisions(s)[0]
    expect(d.type === 'ask' && d.ask.title).toBe('老鬼')
  })
})
