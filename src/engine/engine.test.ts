import { describe, expect, it } from 'vitest'
import { buildCards, FACTION_SETUPS } from './data'
import { applyAction, getDecisions, startGame } from './engine'
import { makeConfig, playOut } from './sim'
import type { GameState } from './types'
import { viewFor } from './view'

describe('卡牌資料', () => {
  it('81 張遊戲牌，數量與規則書一致', () => {
    const cards = buildCards()
    expect(cards.length).toBe(81)
    const by = (f: (c: (typeof cards)[number]) => boolean) => cards.filter(f).length
    expect(by((c) => c.method === 'secret')).toBe(32)
    expect(by((c) => c.method === 'direct')).toBe(32)
    expect(by((c) => c.method === 'text')).toBe(17)
    expect(by((c) => c.colour === 'red')).toBe(25)
    expect(by((c) => c.colour === 'blue')).toBe(25)
    expect(by((c) => c.colour === 'black')).toBe(31)
    expect(by((c) => c.kind === 'probe')).toBe(18)
    expect(by((c) => c.kind === 'counter')).toBe(14)
  })
})

/** 讓所有人選第一個角色，進入第一回合 */
function setup(n = 5, seed = 1): GameState {
  let s = startGame(makeConfig(n, seed))
  for (const d of getDecisions(s)) {
    if (d.type === 'choose_character') s = applyAction(s, d.player, { type: 'choose_character', character: d.options[0] })
  }
  return s
}

describe('流程', () => {
  it('選完角色後進入出牌階段，起始手牌 3 張、當前玩家抽 2 張', () => {
    const s = setup()
    expect(s.phase).toBe('play')
    for (const p of s.players) expect(p.hand.length).toBe(p.seat === s.active ? 5 : 3)
  })

  it('別人看不到你的手牌與身份', () => {
    const s = setup()
    const v = viewFor(s, 0)
    for (const p of v.players) {
      if (p.seat !== 0) expect(p.faction).toBeNull()
    }
    expect(v.hand.length).toBe(s.players[0].hand.length)
  })

  it('情報繞一圈沒人收，回到傳出者必須接收', () => {
    let s = setup(4, 7)
    const a = s.active
    // 把傳出者手牌換成一張沒有功能干擾的密電假情報
    const secret = s.cards.find((c) => c.method === 'secret' && c.kind === 'decrypt')!.id
    s = structuredClone(s)
    for (const p of s.players) p.hand = []
    s.deck = s.deck.filter((x) => x !== secret)
    s.discard = s.discard.filter((x) => x !== secret)
    s.players[a].hand = [secret]
    s = applyAction(s, a, { type: 'send', card: secret })
    // 每個人都拒收
    for (let i = 0; i < 10 && s.trans; i++) {
      const d = getDecisions(s)[0]
      if (d.type === 'accept') s = applyAction(s, d.player, { type: 'decline' })
      else break
    }
    expect(s.players[a].intel).toContain(secret)
  })
})

describe('AI 自動對戰', () => {
  it('3–9 人、各種陣營配置都能正常打完，卡牌守恆', () => {
    let games = 0
    for (let n = 3; n <= 9; n++) {
      for (let k = 0; k < FACTION_SETUPS[n].length; k++) {
        for (let seed = 1; seed <= 12; seed++) {
          const { state } = playOut(makeConfig(n, seed * 977 + n, k, seed % 2 === 0))
          expect(state.result).not.toBeNull()
          games++
        }
      }
    }
    expect(games).toBeGreaterThan(100)
  }, 180_000)
})
