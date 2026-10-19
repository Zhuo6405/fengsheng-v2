import { currentCtx, getDecisions, legalPlays, legalSkills, peekNext } from './engine'
import type { Card, Decision, Faction, GameResult, GameState, LegalPlay, LegalSkill, LogEntry, Method, PlayerStatus } from './types'

// 每位玩家只能看到的資訊。多人連線時，房主只把這份資料送給對應的玩家，
// 所以別人的手牌、身份、蓋伏的角色都不會出現在他的瀏覽器裡。

export interface PublicPlayer {
  seat: number
  name: string
  isAI: boolean
  status: PlayerStatus
  handCount: number
  intel: Card[]
  /** 公開或自己的角色；別人蓋伏的角色為 null */
  character: string | null
  charFaceUp: boolean
  /** 自己的身份、已公開的身份，或遊戲結束後公開 */
  faction: Faction | null
  identityRevealed: boolean
}

export interface TransView {
  sender: number
  method: Method
  holder: number
  target: number | null
  dir: 1 | -1
  stage: string
  /** 看得到內容才有值 */
  card: Card | null
  next: number
  hops: number
}

export interface StackView {
  uid: number
  kind: Card['kind']
  printed: Card['kind']
  colour: Card['colour']
  uncounterable: boolean
  user: number
  target?: number
  targetRef?: number
  countered: boolean
}

export interface GameView {
  me: number
  phase: GameState['phase']
  active: number
  turnNo: number
  players: PublicPlayer[]
  hand: Card[]
  myCharOptions: string[]
  deckCount: number
  discardCount: number
  trans: TransView | null
  locks: number[]
  diverts: number[]
  stack: StackView[]
  window: GameState['window']
  decision: Decision | null
  legal: LegalPlay[]
  skills: LegalSkill[]
  log: LogEntry[]
  result: GameResult | null
  deaths: number[]
  factions: [number, number, number]
  neutralAlliance: boolean
}

const strip = (c: Card): Card => {
  const { probe: _probe, ...rest } = c
  void _probe
  return rest
}

export function viewFor(s: GameState, me: number): GameView {
  const over = s.phase === 'over'
  const dec = getDecisions(s).find((d) => d.player === me) ?? null
  const t = s.trans
  const ctx = currentCtx(s)
  return {
    me,
    phase: s.phase,
    active: s.active,
    turnNo: s.turnNo,
    players: s.players.map((pl) => {
      const mine = pl.seat === me
      return {
        seat: pl.seat,
        name: pl.name,
        isAI: pl.isAI,
        status: pl.status,
        handCount: pl.hand.length,
        intel: pl.intel.map((id) => s.cards[id]).map(strip),
        character: mine || pl.charFaceUp || over ? pl.character : null,
        charFaceUp: pl.charFaceUp,
        faction: mine || over || pl.identityRevealed ? pl.faction : null,
        identityRevealed: pl.identityRevealed,
      }
    }),
    hand: s.players[me].hand.map((id) => s.cards[id]),
    myCharOptions: s.players[me].charOptions,
    deckCount: s.deck.length,
    discardCount: s.discard.length,
    trans: t
      ? {
          sender: t.sender,
          method: t.method,
          holder: t.holder,
          target: t.target,
          dir: t.dir,
          stage: t.stage,
          card: t.method === 'text' || t.peeked.includes(me) ? strip(s.cards[t.card]) : null,
          next: peekNext(s),
          hops: t.hops,
        }
      : null,
    locks: [...s.locks],
    diverts: [...s.diverts],
    stack: s.stack.map((it) => ({
      uid: it.uid,
      kind: it.kind,
      printed: it.printed,
      colour: s.cards[it.card].colour,
      uncounterable: it.uncounterable,
      user: it.user,
      target: it.target,
      targetRef: it.targetRef,
      countered: it.countered,
    })),
    window: s.window,
    decision: dec,
    legal: dec && (dec.type === 'priority' || dec.type === 'play') ? legalPlays(s, me, ctx) : [],
    skills: dec && (dec.type === 'priority' || dec.type === 'play') ? legalSkills(s, me, ctx) : [],
    log: s.log.filter((l) => l.vis === null || l.vis.includes(me)),
    result: s.result,
    deaths: [...s.deaths],
    factions: s.config.factions,
    neutralAlliance: s.config.neutralAlliance,
  }
}
