import { CHARACTERS, CHAR_BY_ID, COLOUR_NAME, FACTION_NAME, FACTION_SETUPS, KIND_NAME, METHOD_NAME, buildCards } from './data'
import type {
  Action,
  Ask,
  AskChoice,
  AutoStep,
  Card,
  Ctx,
  Decision,
  Faction,
  GameConfig,
  GameState,
  LegalPlay,
  LegalSkill,
  Mission,
  ObtainCause,
  Player,
  StackItem,
} from './types'

// ───────────────────────── 亂數（可重現） ─────────────────────────

function rand(s: GameState): number {
  const a = (s.rng + 0x6d2b79f5) | 0
  s.rng = a
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function shuffle<T>(s: GameState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ───────────────────────── 小工具 ─────────────────────────

export class RuleError extends Error {}

const fail = (msg: string): never => {
  throw new RuleError(msg)
}

export const cardOf = (s: GameState, id: number): Card => s.cards[id]
const nm = (s: GameState, p: number) => s.players[p].name
export const isAlive = (s: GameState, p: number) => s.players[p]?.status === 'alive'
export const aliveSeats = (s: GameState) => s.players.filter((pl) => pl.status === 'alive').map((pl) => pl.seat)

export function nextAlive(s: GameState, p: number, dir: 1 | -1 = 1): number {
  const n = s.players.length
  for (let k = 1; k <= n; k++) {
    const q = (((p + dir * k) % n) + n) % n
    if (isAlive(s, q)) return q
  }
  return -1
}

/** 從 from 開始依順位（往右）排列的存活座位 */
function seatOrder(s: GameState, from: number): number[] {
  const n = s.players.length
  const out: number[] = []
  for (let k = 0; k < n; k++) {
    const q = (from + k) % n
    if (isAlive(s, q)) out.push(q)
  }
  return out
}

export const countColour = (s: GameState, ids: number[], colour: Card['colour']) =>
  ids.filter((id) => s.cards[id].colour === colour).length

const blackCount = (s: GameState, p: number) => countColour(s, s.players[p].intel, 'black')

export const cardLabel = (s: GameState, id: number) => {
  const c = s.cards[id]
  return `${COLOUR_NAME[c.colour]}·${KIND_NAME[c.kind]}`
}

function log(s: GameState, text: string, vis: number[] | null = null) {
  s.log.push({ seq: s.log.length, text, vis, turn: s.turnNo })
}

/** 角色的有效性別（蓋伏時無性別） */
export function genderOf(s: GameState, p: number): 'male' | 'female' | 'both' | null {
  const pl = s.players[p]
  if (!pl.character || !pl.charFaceUp) return null
  return CHAR_BY_ID[pl.character].gender
}

const isFemale = (s: GameState, p: number) => {
  const g = genderOf(s, p)
  return g === 'female' || g === 'both'
}

/** 存活、是這個角色、而且角色是翻開的（技能有效） */
const up = (s: GameState, p: number, id: string) => isAlive(s, p) && s.players[p].character === id && s.players[p].charFaceUp
/** 存活、是這個角色、而且還蓋伏著（只能用「翻開此角色」的技能） */
const down = (s: GameState, p: number, id: string) => isAlive(s, p) && s.players[p].character === id && !s.players[p].charFaceUp
const charName = (id: string) => CHAR_BY_ID[id].name

function flipUp(s: GameState, p: number) {
  const pl = s.players[p]
  pl.charFaceUp = true
  log(s, `${pl.name} 翻開角色：【${charName(pl.character!)}】`)
}

function flipDown(s: GameState, p: number, why = '') {
  const pl = s.players[p]
  pl.charFaceUp = false
  log(s, `${pl.name} 的角色被蓋伏${why}。`)
}

/** 從牌庫頂取一張（牌庫空了就洗棄牌堆） */
function takeTop(s: GameState): number | null {
  if (s.deck.length === 0) {
    if (s.discard.length === 0) return null
    s.deck = shuffle(s, s.discard)
    s.discard = []
    log(s, '牌庫用完，棄牌堆洗混成為新的牌庫。')
  }
  return s.deck.pop()!
}

function draw(s: GameState, p: number, n: number, silent = false) {
  let got = 0
  for (let i = 0; i < n; i++) {
    const c = takeTop(s)
    if (c == null) break
    s.players[p].hand.push(c)
    got++
  }
  if (!silent && got > 0) log(s, `${nm(s, p)} 抽了 ${got} 張牌`)
}

function removeFromHand(s: GameState, p: number, card: number) {
  s.players[p].hand = s.players[p].hand.filter((c) => c !== card)
}

function randomHandCard(s: GameState, p: number): number | null {
  const h = s.players[p].hand
  if (!h.length) return null
  return h[Math.floor(rand(s) * h.length)]
}

// ───────────────────────── 佇列 ─────────────────────────

/** 接在目前步驟後面立刻處理 */
const now = (s: GameState, ...items: (Ask | AutoStep)[]) => s.q.unshift(...items)
/** 排到最後（新觸發的技能） */
const later = (s: GameState, ...items: (Ask | AutoStep)[]) => s.q.push(...items)

function ask(
  player: number,
  step: string,
  title: string,
  prompt: string,
  choice: AskChoice,
  canSkip: boolean,
  data: Record<string, unknown> = {},
): Ask {
  return { k: 'ask', player, step, title, prompt, choice, canSkip, data }
}

const auto = (step: string, data: Record<string, unknown> = {}): AutoStep => ({ k: 'auto', step, data })

const handPick = (s: GameState, p: number, min: number, max: number, filter?: (c: Card) => boolean): AskChoice => {
  const ids = s.players[p].hand.filter((id) => !filter || filter(s.cards[id]))
  return { kind: 'cards', zone: 'hand', owner: p, ids, min: Math.min(min, ids.length), max: Math.min(max, ids.length) }
}

const intelPick = (s: GameState, owner: number, min: number, max: number, filter?: (c: Card) => boolean): AskChoice => {
  const ids = s.players[owner].intel.filter((id) => !filter || filter(s.cards[id]))
  return { kind: 'cards', zone: 'intel', owner, ids, min: Math.min(min, ids.length), max: Math.min(max, ids.length) }
}

const isBlack = (c: Card) => c.colour === 'black'

// ───────────────────────── 開局 ─────────────────────────

export function createGame(config: GameConfig): GameState {
  const n = config.players.length
  if (n < 3 || n > 9) fail('人數必須是 3 到 9 人')
  const [r, b, k] = config.factions
  if (r + b + k !== n) fail('陣營人數加總與玩家人數不符')
  const allowed = FACTION_SETUPS[n].some((f) => f[0] === r && f[1] === b && f[2] === k)
  if (!allowed) fail('不是這個人數的標準陣營配置')

  const s: GameState = {
    config,
    cards: buildCards(),
    players: config.players.map(
      (p, seat): Player => ({
        id: p.id,
        name: p.name,
        isAI: p.isAI,
        seat,
        faction: 'neutral',
        character: null,
        charOptions: [],
        charFaceUp: false,
        hand: [],
        intel: [],
        status: 'alive',
        identityRevealed: false,
      }),
    ),
    deck: [],
    discard: [],
    rng: config.seed | 0,
    phase: 'choose_character',
    active: 0,
    turnNo: 0,
    locks: [],
    diverts: [],
    trans: null,
    stack: [],
    window: null,
    prio: null,
    reopenFrom: null,
    q: [],
    pendingKiller: {},
    log: [],
    deaths: [],
    killerCredit: [],
    deathWins: [],
    result: null,
    seq: 1,
  }
  const chars = shuffle(
    s,
    CHARACTERS.map((c) => c.id),
  )
  s.players.forEach((pl, i) => {
    pl.charOptions = [chars[2 * i], chars[2 * i + 1]]
  })
  log(s, `遊戲開始：${n} 人局（潛伏戰線 ${r}、軍情局 ${b}、特工 ${k}）。請挑選角色。`)
  return s
}

function afterCharacters(s: GameState) {
  const facs: Faction[] = []
  const [r, b, k] = s.config.factions
  for (let i = 0; i < r; i++) facs.push('red')
  for (let i = 0; i < b; i++) facs.push('blue')
  for (let i = 0; i < k; i++) facs.push('neutral')
  shuffle(s, facs)
  s.players.forEach((pl, i) => {
    pl.faction = facs[i]
    pl.charFaceUp = !CHAR_BY_ID[pl.character!].hidden
    log(s, `你的身份是【${FACTION_NAME[pl.faction]}】`, [i])
  })
  s.deck = shuffle(
    s,
    s.cards.map((c) => c.id),
  )
  for (const pl of s.players) draw(s, pl.seat, 3, true)
  s.active = Math.floor(rand(s) * s.players.length)
  log(s, '身份牌已發出，每人起始手牌 3 張。')
  startTurn(s)
}

// ───────────────────────── 回合 ─────────────────────────

function startTurn(s: GameState) {
  s.turnNo++
  s.locks = []
  s.diverts = []
  s.phase = 'play'
  const a = s.active
  log(s, `── 第 ${s.turnNo} 回合：${nm(s, a)} ──`)
  if (up(s, a, 'dameinv')) {
    draw(s, a, 3)
    later(s, ask(a, 'dameinvReturn', '大美女', '抽牌階段：選一張手牌放回牌庫頂。', handPick(s, a, 1, 1), false))
  } else {
    draw(s, a, 2)
  }
}

function nextTurn(s: GameState) {
  s.trans = null
  s.window = null
  s.prio = null
  s.reopenFrom = null
  if (s.result) return
  const nx = nextAlive(s, s.active)
  if (nx < 0) return endDraw(s)
  s.active = nx
  startTurn(s)
}

function endDraw(s: GameState, oneLeft = false) {
  const reason = oneLeft ? '只剩一位玩家存活且無人達成勝利條件，平手。' : '所有玩家都已出局，平手。'
  s.result = { winners: [], declarer: null, reason }
  s.phase = 'over'
  s.q = []
  log(s, `★ ${reason}`)
  revealAll(s)
}

/** 輸掉遊戲（不是死亡，不觸發死亡時的技能） */
function eliminate(s: GameState, p: number, why: string) {
  const pl = s.players[p]
  pl.status = 'out'
  log(s, `${pl.name} ${why}，輸掉遊戲。`)
  s.discard.push(...pl.hand, ...pl.intel)
  pl.hand = []
  pl.intel = []
}

/** 真正死亡：觸發死亡時的技能，之後才把他的牌放進棄牌堆 */
function kill(s: GameState, p: number) {
  const pl = s.players[p]
  pl.status = 'dead'
  s.deaths.push(p)
  log(s, `☠ ${pl.name} 獲得三張假情報，死亡。`)
  const killer = s.pendingKiller[p]
  if (killer != null && killer !== p && s.deaths.length >= 2) s.killerCredit.push(killer)
  if (pl.faction === 'neutral' && pl.character) {
    const m = CHAR_BY_ID[pl.character].mission
    if (m.type === 'deathHandRed') {
      const reds = countColour(s, pl.hand, 'red')
      log(s, `${pl.name} 展示手牌：紅色卡牌 ${reds} 張。`)
      if (reds >= m.n) s.deathWins.push(p)
    }
  }
  const items: (Ask | AutoStep)[] = []
  // 老鬼：死亡時把手牌交給一位玩家
  if (pl.character === 'laogui' && pl.charFaceUp && pl.hand.length > 0) {
    const seats = aliveSeats(s)
    if (seats.length)
      items.push(ask(p, 'laoguiGive', '老鬼', '你死亡了：可以把全部手牌交給一位玩家，他隨機選三張作為情報。', { kind: 'player', seats }, true))
  }
  for (const q of seatOrder(s, s.active)) {
    if (q === p) continue
    if (up(s, q, 'liujie')) items.push(auto('trig', { name: 'liujieDeath', owner: q, dead: p }))
    if (up(s, q, 'daofeng')) items.push(auto('trig', { name: 'daofengDraw', owner: q, dead: p }))
  }
  items.push(auto('discardDead', { p }))
  now(s, ...items)
}

/** 玩家獲得一張情報（面朝上放在面前），並排入相關的觸發技能 */
function obtain(s: GameState, p: number, card: number, cause: ObtainCause) {
  const pl = s.players[p]
  if (pl.status !== 'alive') {
    s.discard.push(card)
    return
  }
  pl.intel.push(card)
  log(s, `${pl.name} 獲得情報：${cardLabel(s, card)}`)
  const black = s.cards[card].colour === 'black'
  const causer = cause.by === 'trans' ? cause.sender : cause.user
  if (blackCount(s, p) >= 3) {
    s.pendingKiller[p] ??= causer
    return // 他會死，自己的觸發不用處理
  }
  if (!black) return
  const trans = cause.by === 'trans'
  const sender = trans ? cause.sender : null
  const trig: { owner: number; name: string; data: Record<string, unknown> }[] = []
  if (up(s, p, 'mengmian')) trig.push({ owner: p, name: 'mengmianDraw', data: {} })
  if (up(s, p, 'laojin')) trig.push({ owner: p, name: 'laojinB', data: {} })
  if (trans && sender !== p) {
    if (up(s, p, 'xiaomage')) trig.push({ owner: p, name: 'xiaomage', data: {} })
    if (up(s, p, 'guaidao')) trig.push({ owner: p, name: 'guaidaoTake', data: { from: sender } })
    if (up(s, sender!, 'shashou')) trig.push({ owner: sender!, name: 'shashouPlace', data: { target: p } })
    if (up(s, sender!, 'guaidao')) trig.push({ owner: sender!, name: 'guaidaoTake', data: { from: p } })
    if (up(s, sender!, 'emeifeng')) trig.push({ owner: sender!, name: 'emeiBurn', data: {} })
  }
  const order = seatOrder(s, s.active)
  trig.sort((a, b) => order.indexOf(a.owner) - order.indexOf(b.owner))
  later(s, ...trig.map((t) => auto('trig', { name: t.name, owner: t.owner, ...t.data })))
}

/** 把手牌中的一張放到某位玩家面前作為情報 */
function place(s: GameState, from: number, card: number, to: number) {
  removeFromHand(s, from, card)
  obtain(s, to, card, { by: 'skill', user: from })
}

function burnIntel(s: GameState, owner: number, card: number) {
  const pl = s.players[owner]
  if (!pl.intel.includes(card)) return
  pl.intel = pl.intel.filter((x) => x !== card)
  s.discard.push(card)
  log(s, `${pl.name} 的 ${cardLabel(s, card)} 被燒毀。`)
}

function giveCard(s: GameState, from: number, card: number, to: number) {
  removeFromHand(s, from, card)
  s.players[to].hand.push(card)
  log(s, `${nm(s, from)} 交給 ${nm(s, to)} 一張牌。`)
  log(s, `你收到：${cardLabel(s, card)}`, [to])
}

function takeRandom(s: GameState, taker: number, from: number, asIntel = false) {
  const c = randomHandCard(s, from)
  if (c == null) return log(s, `${nm(s, from)} 沒有手牌，抽取落空。`)
  removeFromHand(s, from, c)
  if (asIntel) {
    log(s, `${nm(s, taker)} 抽取 ${nm(s, from)} 的一張手牌作為情報。`)
    obtain(s, taker, c, { by: 'skill', user: taker })
  } else {
    s.players[taker].hand.push(c)
    log(s, `${nm(s, taker)} 抽取了 ${nm(s, from)} 的一張手牌。`)
    log(s, `你抽到：${cardLabel(s, c)}`, [taker])
  }
}

// ───────────────────────── 勝負 ─────────────────────────

const factionWiped = (s: GameState, f: 'red' | 'blue') => {
  const members = s.players.filter((pl) => pl.faction === f)
  return members.length > 0 && members.every((pl) => pl.status !== 'alive')
}

function otherGenderOnField(s: GameState, p: number, g: 'male' | 'female') {
  return s.players.some((pl) => {
    if (pl.seat === p || pl.status !== 'alive') return false
    const og = genderOf(s, pl.seat)
    return og === g || og === 'both'
  })
}

function missionMet(s: GameState, p: number): boolean {
  const pl = s.players[p]
  if (!pl.character) return false
  const m: Mission = CHAR_BY_ID[pl.character].mission
  const alive = pl.status === 'alive'
  const aliveN = aliveSeats(s).length
  switch (m.type) {
    case 'intel':
      return alive && countColour(s, pl.intel, m.colour) >= m.n
    case 'nonBlack':
      return alive && pl.intel.length - countColour(s, pl.intel, 'black') >= m.n
    case 'totalIntel':
      return alive && pl.intel.length >= m.n
    case 'handSize':
      return alive && pl.hand.length >= m.n
    case 'handColours':
      return alive && countColour(s, pl.hand, 'red') >= m.red && countColour(s, pl.hand, 'blue') >= m.blue
    case 'wipeout':
      return alive && factionWiped(s, m.faction)
    case 'deathHandRed':
      return s.deathWins.includes(p)
    case 'killer':
      return alive && s.killerCredit.includes(p)
    case 'femaleDeclares':
      return alive && !otherGenderOnField(s, p, 'female') && aliveN === 1
    case 'maleDeclaresLowBlack':
      return alive && !otherGenderOnField(s, p, 'male') && aliveN === 1
    case 'lastTwo':
      return alive && aliveN === 2
    case 'firstDeathOrWipe':
      return s.deaths[0] === p || (alive && (factionWiped(s, 'red') || factionWiped(s, 'blue')))
  }
}

/** 狀態檢查：死亡（可能被救）、小白出局、勝利。有做事就回傳 true */
function settle(s: GameState): boolean {
  if (s.result || s.phase === 'choose_character') return false
  // 死亡
  for (const p of seatOrder(s, s.active)) {
    if (blackCount(s, p) < 3) continue
    const saver = isFemale(s, p)
      ? seatOrder(s, s.active).find((q) => q !== p && up(s, q, 'mengmian') && !s.players[q].identityRevealed)
      : undefined
    if (saver != null && !s.pendingKiller[`save${p}` as unknown as number]) {
      ;(s.pendingKiller as Record<string, number | null>)[`save${p}`] = saver
      now(
        s,
        ask(
          saver,
          'mengmianSave',
          '禮服蒙面人',
          `${nm(s, p)} 即將死亡。要翻開你的身份牌，燒毀她的二張假情報救她嗎？`,
          { kind: 'confirm' },
          true,
          { p },
        ),
      )
      return true
    }
    delete (s.pendingKiller as Record<string, number | null>)[`save${p}`]
    kill(s, p)
    return true
  }
  // 小白：六張情報就輸
  for (const p of aliveSeats(s)) {
    if (up(s, p, 'xiaobai') && s.players[p].intel.length >= 6) {
      eliminate(s, p, '（小白）獲得六張情報')
      return true
    }
  }
  // 勝利
  const n = s.players.length
  for (let k = 0; k < n; k++) {
    const p = (s.active + k) % n
    const pl = s.players[p]
    if (pl.status === 'alive' && pl.faction !== 'neutral' && countColour(s, pl.intel, pl.faction) >= 3) {
      declare(s, p, 'faction')
      return true
    }
    if (pl.faction === 'neutral' && missionMet(s, p)) {
      declare(s, p, 'mission')
      return true
    }
  }
  if (aliveSeats(s).length <= 1) {
    endDraw(s, aliveSeats(s).length === 1)
    return true
  }
  return false
}

function declare(s: GameState, p: number, why: 'faction' | 'mission') {
  // 柒佰：宣告勝利時，選擇一位女性一同勝利
  if (up(s, p, 'qibai')) {
    const females = aliveSeats(s).filter((q) => q !== p && isFemale(s, q))
    if (females.length) {
      s.phase = 'over'
      now(s, ask(p, 'qibaiPick', '柒佰', '你宣告勝利：選擇一位女性一同勝利。', { kind: 'player', seats: females }, false, { why }))
      return
    }
  }
  finalize(s, p, why, null)
}

function finalize(s: GameState, p: number, why: 'faction' | 'mission', extra: number | null) {
  const pl = s.players[p]
  const winners = new Set<number>([p])
  let reason: string
  if (why === 'faction') {
    for (const q of s.players) if (q.faction === pl.faction) winners.add(q.seat)
    reason = `${pl.name} 集滿三張${pl.faction === 'red' ? '紅色' : '藍色'}情報，${FACTION_NAME[pl.faction]}獲勝！`
  } else {
    reason = `${pl.name}（${charName(pl.character!)}）完成機密任務：${CHAR_BY_ID[pl.character!].missionText}`
    if (s.config.neutralAlliance) {
      for (const q of s.players) if (q.faction === 'neutral') winners.add(q.seat)
      reason += '（特工同盟一同勝利）'
    }
  }
  if (extra != null) {
    winners.add(extra)
    reason += `（柒佰選擇 ${nm(s, extra)} 一同勝利）`
  }
  const g = genderOf(s, p)
  for (const q of s.players) {
    if (winners.has(q.seat) || q.faction !== 'neutral' || q.status !== 'alive' || !q.character) continue
    const m = CHAR_BY_ID[q.character].mission
    if (m.type === 'femaleDeclares' && (g === 'female' || g === 'both')) winners.add(q.seat)
    if (m.type === 'maleDeclaresLowBlack' && (g === 'male' || g === 'both') && countColour(s, q.intel, 'black') <= 1)
      winners.add(q.seat)
  }
  s.result = { winners: [...winners].sort((a, b) => a - b), declarer: p, reason }
  s.phase = 'over'
  s.prio = null
  s.window = null
  s.q = []
  log(s, `★ ${reason}`)
  revealAll(s)
}

function revealAll(s: GameState) {
  const parts = s.players.map((pl) => `${pl.name}＝${FACTION_NAME[pl.faction]}（${pl.character ? charName(pl.character) : '—'}）`)
  log(s, `身份公開：${parts.join('、')}`)
}

// ───────────────────────── 情報傳遞 ─────────────────────────

/** 依目前狀態算出這一跳情報會傳到誰 */
export function peekNext(s: GameState): number {
  const t = s.trans
  if (!t) return -1
  if (t.toSender) return t.sender
  const free = (q: number) => !s.diverts.includes(q) || s.locks.includes(q)
  if (t.method === 'direct') {
    const tg = t.target!
    if (!isAlive(s, tg) || !free(tg)) return t.sender
    return tg
  }
  const n = s.players.length
  for (let k = 1; k <= n; k++) {
    const q = (((t.holder + t.dir * k) % n) + n) % n
    if (q === t.sender) return t.sender
    if (!isAlive(s, q) || !free(q)) continue
    return q
  }
  return t.sender
}

export function currentCtx(s: GameState): Ctx {
  if (s.stack.length) return 'resp'
  return s.window ?? 'play'
}

/** 回傳玩家 p 在目前時機能用的所有手牌與目標 */
export function legalPlays(s: GameState, p: number, ctx: Ctx = currentCtx(s)): LegalPlay[] {
  const pl = s.players[p]
  if (!pl || pl.status !== 'alive' || s.result) return []
  const out: LegalPlay[] = []
  const others = aliveSeats(s).filter((q) => q !== p)
  const t = s.trans
  const burnRefs = () => {
    const refs: { target: number; ref: number }[] = []
    for (const q of aliveSeats(s))
      for (const id of s.players[q].intel) if (s.cards[id].colour === 'black') refs.push({ target: q, ref: id })
    return refs
  }
  // 鎖定的時機：自己回合的出牌或傳遞時；柒佰在他人回合的傳遞中也可以
  const lockTime = (p === s.active && (ctx === 'play' || ctx === 'hopA')) || (up(s, p, 'qibai') && p !== s.active && ctx === 'hopA')
  const lockTargets = others.filter((q) => !s.locks.includes(q))
  const daofeng = up(s, p, 'daofeng')
  for (const id of pl.hand) {
    const c = s.cards[id]
    const kind = c.kind
    const add = (extra: Partial<LegalPlay> = {}) => out.push({ card: id, kind, ...extra })
    const asLock = (uncounterable: boolean) => {
      if (lockTime && lockTargets.length) out.push({ card: id, kind: 'lock', as: true, targets: lockTargets, uncounterable })
    }
    if (ctx === 'resp') {
      if (kind === 'counter') {
        const top = s.stack[s.stack.length - 1]
        if (top.user !== p && !top.uncounterable) add({ refs: [{ target: top.user, ref: top.uid }] })
      }
      continue
    }
    // 角色的「當作鎖定使用」
    if (kind === 'counter' && up(s, p, 'shashou')) asLock(false)
    if (kind === 'probe' && daofeng) asLock(true)
    if (c.colour === 'black' && up(s, p, 'beileimao')) asLock(true)
    switch (kind) {
      case 'lock':
        if (lockTime && lockTargets.length) add({ targets: lockTargets, uncounterable: daofeng })
        break
      case 'divert': {
        if (ctx !== 'hopA' || !t) break
        const tg = aliveSeats(s).filter((q) => q !== t.sender && !s.locks.includes(q) && !s.diverts.includes(q))
        if (tg.length) add({ targets: tg })
        break
      }
      case 'intercept':
        if (ctx === 'hopA' && t && t.obtainedBy == null && p !== s.active) add()
        break
      case 'return':
        if (ctx === 'hopB' && t && p === t.holder && p !== t.sender && !s.locks.includes(p)) add()
        break
      case 'decrypt':
        if (ctx === 'hopB' && t && p === t.holder && !t.peeked.includes(p) && t.method !== 'text') add()
        break
      case 'burn': {
        if (ctx === 'play' && p !== s.active) break
        const refs = burnRefs()
        if (refs.length) add({ refs })
        break
      }
      case 'probe':
        if (ctx === 'play' && p === s.active && others.length) add({ targets: others })
        break
      case 'chaos':
        if (ctx === 'play' && p === s.active) add()
        break
      case 'counter':
        break
    }
  }
  return out
}

/** 現在可以主動發動的角色技能 */
export function legalSkills(s: GameState, p: number, ctx: Ctx = currentCtx(s)): LegalSkill[] {
  const pl = s.players[p]
  if (!pl || pl.status !== 'alive' || s.result || !pl.character) return []
  if (ctx === 'play' && p !== s.active) return []
  const out: LegalSkill[] = []
  const others = aliveSeats(s).filter((q) => q !== p)
  const t = s.trans
  if (down(s, p, 'shanling') && others.some((q) => s.players[q].intel.length > 0))
    out.push({ id: 'shanling', label: '翻開【閃靈】：燒毀一位玩家三張情報' })
  if (down(s, p, 'heimeigui')) out.push({ id: 'heimeigui', label: '翻開【黑玫瑰】：放置假情報' })
  if (down(s, p, 'emeifeng')) {
    const canGrab = !!t && t.obtainedBy == null && p !== s.active
    out.push({ id: 'emeifeng', label: canGrab ? '翻開【峨嵋風】：截獲這份情報' : '翻開【峨嵋風】（現在沒有可截獲的情報）' })
  }
  if (down(s, p, 'yidianyuan') && ctx === 'hopB' && t && t.holder === p)
    out.push({ id: 'yidian', label: '翻開【譯電員】：抽一張牌並檢視情報' })
  if (up(s, p, 'laoqiang') && others.some((q) => s.players[q].charFaceUp))
    out.push({ id: 'laoqiang', label: '【老槍】蓋伏自己與另一位玩家，互看身份' })
  if (up(s, p, 'dameinv') && !pl.identityRevealed && aliveSeats(s).some((q) => blackCount(s, q) > 0))
    out.push({ id: 'dameinv', label: '【大美女】翻開身份牌：燒毀一張假情報' })
  if (up(s, p, 'xiaobai') && pl.hand.length >= 3 && others.some((q) => s.players[q].intel.length > 0))
    out.push({ id: 'xiaobai', label: '【小白】交出三張手牌，換一張情報' })
  return out
}

// ───────────────────────── 堆疊（後發先至） ─────────────────────────

function pushStack(s: GameState, p: number, lp: LegalPlay, target?: number, ref?: number) {
  const pl = s.players[p]
  removeFromHand(s, p, lp.card)
  if (s.stack.length === 0 && s.window) s.reopenFrom = nextAlive(s, p)
  const printed = s.cards[lp.card].kind
  const item: StackItem = {
    uid: s.seq++,
    card: lp.card,
    kind: lp.kind,
    printed,
    user: p,
    target,
    targetRef: ref,
    countered: false,
    uncounterable: !!lp.uncounterable,
  }
  s.stack.push(item)
  let text = lp.as
    ? `${pl.name} 把【${KIND_NAME[printed]}】當作【${KIND_NAME[lp.kind]}】使用`
    : `${pl.name} 使用【${KIND_NAME[lp.kind]}】`
  if (lp.kind === 'counter') {
    const tg = s.stack.find((x) => x.uid === ref)
    if (tg) text += `，目標是 ${nm(s, tg.user)} 的【${KIND_NAME[tg.kind]}】`
  } else if (lp.kind === 'burn' && target != null && ref != null) {
    text += `，燒毀 ${nm(s, target)} 的 ${cardLabel(s, ref)}`
  } else if (target != null) {
    text += `，目標：${nm(s, target)}`
  }
  if (item.uncounterable) text += '（不能被識破）'
  log(s, text)
  s.prio = { current: nextAlive(s, p), passes: 0 }
}

function resolveTop(s: GameState) {
  const it = s.stack.pop()!
  const c = s.cards[it.card]
  s.discard.push(it.card)
  if (it.countered) {
    log(s, `${nm(s, it.user)} 的【${KIND_NAME[it.kind]}】被識破，無效。`)
    return
  }
  const t = s.trans
  switch (it.kind) {
    case 'counter': {
      const tg = s.stack.find((x) => x.uid === it.targetRef)
      if (tg) {
        tg.countered = true
        if (down(s, tg.user, 'laojin')) later(s, auto('trig', { name: 'laojinFlip', owner: tg.user }))
      }
      break
    }
    case 'lock': {
      const tg = it.target!
      if (!s.locks.includes(tg)) s.locks.push(tg)
      log(s, `${nm(s, tg)} 被鎖定：本回合情報傳到他時必須接收。`)
      if (up(s, it.user, 'qibai')) {
        draw(s, it.user, 2)
        if (others(s, it.user).length && s.players[it.user].hand.length)
          later(s, ask(it.user, 'qibaiGive', '柒佰', '使用鎖定：選一張手牌交給另一位玩家。', handPick(s, it.user, 1, 1), false))
      }
      if (down(s, tg, 'laoqiang')) later(s, auto('trig', { name: 'laoqiangFlip', owner: tg }))
      break
    }
    case 'divert':
      if (!s.diverts.includes(it.target!)) s.diverts.push(it.target!)
      log(s, `${nm(s, it.target!)} 被調虎離山，不參與本次傳遞。`)
      break
    case 'intercept':
      if (t && t.obtainedBy == null) grab(s, it.user)
      else log(s, `${nm(s, it.user)} 的截獲落空。`)
      break
    case 'return':
      if (t) {
        t.returned = true
        log(s, `${nm(s, it.user)} 退回情報，情報反方向傳遞。`)
      }
      break
    case 'decrypt':
      if (t && !t.peeked.includes(it.user)) {
        t.peeked.push(it.user)
        log(s, `${nm(s, it.user)} 破譯了情報。`)
        log(s, `破譯結果：這份情報是 ${cardLabel(s, t.card)}`, [it.user])
        for (const q of seatOrder(s, s.active)) if (up(s, q, 'yidianyuan')) later(s, auto('trig', { name: 'yidianCover', owner: q }))
      }
      break
    case 'burn':
      if (isAlive(s, it.target!) && s.players[it.target!].intel.includes(it.targetRef!)) burnIntel(s, it.target!, it.targetRef!)
      break
    case 'probe': {
      const tgt = it.target!
      if (!isAlive(s, tgt)) break
      const spec = c.probe!
      const match = s.players[tgt].faction === spec.guess
      log(
        s,
        `試探內容：「我打賭你是${FACTION_NAME[spec.guess]}。如果是，你${spec.effect === 'draw2' ? '抽二張牌' : '棄一張牌'}；否則你說「${
          spec.effect === 'draw2' ? '我是臥底' : '我是好人'
        }」。」—— ${match ? '猜中了' : '沒猜中'}`,
        [it.user, tgt],
      )
      // 老鬼：被試探時翻開（強制），翻開後可以隱瞞身份
      if (down(s, tgt, 'laogui')) {
        flipUp(s, tgt)
        draw(s, tgt, 2)
      }
      if (up(s, tgt, 'laogui')) {
        later(
          s,
          ask(
            tgt,
            'laoguiHide',
            '老鬼',
            `你被試探了（${match ? '猜中' : '沒猜中'}）。要照實回應，還是隱瞞？`,
            {
              kind: 'options',
              options: [
                { id: 'truth', label: '照實回應' },
                { id: 'match', label: `假裝猜中（${spec.effect === 'draw2' ? '抽二張' : '棄一張'}）` },
                { id: 'miss', label: `假裝沒猜中（說「${spec.effect === 'draw2' ? '我是臥底' : '我是好人'}」）` },
              ],
            },
            false,
            { card: it.card, match },
          ),
        )
      } else {
        probeEffect(s, tgt, it.card, match)
      }
      if (down(s, tgt, 'laoqiang')) later(s, auto('trig', { name: 'laoqiangFlip', owner: tgt }))
      if (up(s, it.user, 'liujie')) later(s, auto('trig', { name: 'liujieTake', owner: it.user, from: tgt }))
      for (const q of seatOrder(s, s.active)) if (up(s, q, 'chuzhang')) later(s, auto('trig', { name: 'chuzhang', owner: q }))
      break
    }
    case 'chaos': {
      const order = seatOrder(s, it.user)
      const cards: number[] = []
      for (let i = 0; i < order.length; i++) {
        const x = takeTop(s)
        if (x == null) break
        cards.push(x)
      }
      shuffle(s, cards)
      log(s, `真偽莫辨：翻出 ${cards.length} 張牌，從 ${nm(s, it.user)} 開始每人隨機選一張作為情報。`)
      later(s, auto('chaosNext', { cards, order, i: 0, user: it.user }))
      break
    }
  }
}

const others = (s: GameState, p: number) => aliveSeats(s).filter((q) => q !== p)

function probeEffect(s: GameState, tgt: number, card: number, match: boolean) {
  const spec = s.cards[card].probe!
  if (!match) return log(s, `${nm(s, tgt)} 說：「${spec.effect === 'draw2' ? '我是臥底' : '我是好人'}」`)
  if (spec.effect === 'draw2') return draw(s, tgt, 2)
  if (s.players[tgt].hand.length > 0) {
    now(s, ask(tgt, 'probeDiscard', '試探', '你被試探猜中了，要棄一張牌（暗棄）。', handPick(s, tgt, 1, 1), false))
  } else {
    log(s, `${nm(s, tgt)} 宣告棄一張牌（沒有手牌）。`)
  }
}

/** 截獲：直接獲得傳遞中的情報 */
function grab(s: GameState, p: number) {
  const t = s.trans!
  t.obtainedBy = p
  log(s, `${nm(s, p)} 截獲了情報！`)
  s.window = null
  s.reopenFrom = null
  if (!s.stack.length) s.prio = null
  obtain(s, p, t.card, { by: 'trans', sender: t.sender })
}

// ───────────────────────── 主動技能 ─────────────────────────

function useSkill(s: GameState, p: number, id: string) {
  const pl = s.players[p]
  switch (id) {
    case 'shanling': {
      flipUp(s, p)
      const seats = others(s, p).filter((q) => s.players[q].intel.length > 0)
      now(s, ask(p, 'shanlingTarget', '閃靈', '選擇一位玩家，燒毀他面前的三張情報。', { kind: 'player', seats }, false))
      break
    }
    case 'heimeigui': {
      flipUp(s, p)
      const top = takeTop(s)
      if (top == null) {
        log(s, '牌庫沒有牌可以展示。')
        break
      }
      s.deck.push(top)
      const black = s.cards[top].colour === 'black'
      log(s, `黑玫瑰展示牌庫頂：${cardLabel(s, top)}（${black ? '黑色，最多放三張' : '不是黑色，只能放一張'}）`)
      const hasBlack = pl.hand.some((c) => s.cards[c].colour === 'black')
      if (!hasBlack) {
        log(s, `${pl.name} 手上沒有黑色牌可以放。`)
        break
      }
      now(
        s,
        ask(p, 'heimeiguiTarget', '黑玫瑰', `選擇一位玩家，在他面前放置最多 ${black ? 3 : 1} 張假情報（從你的手牌）。`, { kind: 'player', seats: aliveSeats(s) }, true, {
          n: black ? 3 : 1,
        }),
      )
      break
    }
    case 'emeifeng': {
      flipUp(s, p)
      const t = s.trans
      if (t && t.obtainedBy == null && p !== s.active) grab(s, p)
      break
    }
    case 'yidian': {
      flipUp(s, p)
      draw(s, p, 1)
      const t = s.trans!
      if (!t.peeked.includes(p)) t.peeked.push(p)
      log(s, `譯電員檢視情報：${cardLabel(s, t.card)}`, [p])
      break
    }
    case 'laoqiang': {
      const seats = others(s, p).filter((q) => s.players[q].charFaceUp)
      now(s, ask(p, 'laoqiangCover', '老槍', '選擇一位翻開角色的玩家，蓋伏他的角色，你們互看身份。', { kind: 'player', seats }, true))
      break
    }
    case 'dameinv': {
      const options: { id: string; label: string }[] = []
      for (const q of aliveSeats(s))
        for (const c of s.players[q].intel) if (s.cards[c].colour === 'black') options.push({ id: `${q}:${c}`, label: `${nm(s, q)} 的 ${cardLabel(s, c)}` })
      now(s, ask(p, 'dameinvBurn', '大美女', '翻開身份牌，燒毀一張假情報：', { kind: 'options', options }, true))
      break
    }
    case 'xiaobai': {
      const seats = others(s, p).filter((q) => s.players[q].intel.length > 0)
      now(s, ask(p, 'xiaobaiTarget', '小白', '選擇一位玩家：交給他三張手牌，然後拿走他面前一張情報。', { kind: 'player', seats }, true))
      break
    }
    default:
      fail('沒有這個技能')
  }
}

// ───────────────────────── 觸發與回答 ─────────────────────────

/** 觸發技能排到時再檢查一次條件，再向玩家提問 */
function runTrigger(s: GameState, d: Record<string, unknown>) {
  const o = d.owner as number
  const name = d.name as string
  const A = (step: string, title: string, prompt: string, choice: AskChoice, canSkip: boolean, data: Record<string, unknown> = {}) =>
    now(s, ask(o, step, title, prompt, choice, canSkip, { ...d, ...data }))
  const C = { kind: 'confirm' } as const
  switch (name) {
    case 'laoqiangFlip':
      if (down(s, o, 'laoqiang')) A('laoqiangFlip', '老槍', '要翻開【老槍】抽二張牌嗎？', C, true)
      break
    case 'laojinFlip':
      if (down(s, o, 'laojin')) A('laojinFlip', '老金', '你的卡牌被識破了。要翻開【老金】抽五張牌，再放二張回牌庫頂嗎？', C, true)
      break
    case 'yidianCover':
      if (up(s, o, 'yidianyuan')) A('yidianCover', '譯電員', '有情報被破譯了。要把【譯電員】蓋伏嗎？', C, true)
      break
    case 'liujieTake':
      if (up(s, o, 'liujie') && isAlive(s, d.from as number) && s.players[d.from as number].hand.length)
        A('liujieTake', '六姐', `要抽取 ${nm(s, d.from as number)} 的一張手牌嗎？`, C, true)
      break
    case 'chuzhang':
      if (up(s, o, 'chuzhang')) A('chuzhang', '情報處長', '有玩家被試探了。要抽一張牌，然後棄一張手牌或燒毀你一張非假情報嗎？', C, true)
      break
    case 'mengmianDraw':
      if (up(s, o, 'mengmian')) A('mengmianDraw', '禮服蒙面人', '你獲得了假情報。要抽二張牌嗎？', C, true)
      break
    case 'laojinB':
      if (up(s, o, 'laojin') && s.players[o].hand.some((c) => s.cards[c].colour === 'black'))
        A('laojinB', '老金', '你獲得了假情報。可以再放一張假情報到自己面前並蓋伏老金，然後在任意玩家面前各放一張情報。選一張黑色手牌，或略過。', handPick(s, o, 1, 1, isBlack), true)
      break
    case 'xiaomage':
      if (up(s, o, 'xiaomage')) {
        draw(s, o, 1)
        if (s.players[o].hand.some((c) => s.cards[c].colour === 'black'))
          A('xiaomaTarget', '小馬哥', '你可以在一位玩家面前放一張假情報（從手牌）。選擇玩家，或略過。', { kind: 'player', seats: aliveSeats(s) }, true)
      }
      break
    case 'guaidaoTake': {
      const from = d.from as number
      if (up(s, o, 'guaidao') && isAlive(s, from) && s.players[from].hand.length)
        A('guaidaoTake', '怪盜阿十', `要抽取 ${nm(s, from)} 的一張手牌嗎？`, C, true)
      break
    }
    case 'shashouPlace': {
      const tg = d.target as number
      if (up(s, o, 'shashou') && isAlive(s, tg) && blackCount(s, tg) < 3)
        A('shashouPlace', '職業殺手', `可以在 ${nm(s, tg)} 面前再放一張假情報（選一張黑色手牌），或略過。`, handPick(s, o, 1, 1, isBlack), true)
      break
    }
    case 'emeiBurn': {
      if (!up(s, o, 'emeifeng')) break
      const options: { id: string; label: string }[] = []
      for (const q of aliveSeats(s)) {
        if (q !== o && !isFemale(s, q)) continue
        for (const c of s.players[q].intel) if (s.cards[c].colour === 'black') options.push({ id: `${q}:${c}`, label: `${nm(s, q)} 的 ${cardLabel(s, c)}` })
      }
      if (options.length) A('emeiBurn', '峨嵋風', '可以燒毀你自己或一位女性的一張假情報：', { kind: 'options', options }, true)
      break
    }
    case 'liujieDeath': {
      const dead = d.dead as number
      if (up(s, o, 'liujie') && s.players[dead].hand.length) A('liujieDeath', '六姐', `要抽取 ${nm(s, dead)} 的一張手牌作為你的情報嗎？`, C, true)
      break
    }
    case 'daofengDraw':
      if (up(s, o, 'daofeng')) A('daofengDraw', '刀鋒', '有玩家死亡。要抽二張牌，再把一張手牌交給左手邊的玩家嗎？', C, true)
      break
  }
}

function runAuto(s: GameState, a: AutoStep) {
  const d = a.data
  switch (a.step) {
    case 'trig':
      return runTrigger(s, d)
    case 'discardDead': {
      const pl = s.players[d.p as number]
      s.discard.push(...pl.hand, ...pl.intel)
      pl.hand = []
      pl.intel = []
      return
    }
    case 'chaosNext': {
      const cards = d.cards as number[]
      const order = d.order as number[]
      let i = d.i as number
      while (i < order.length && !isAlive(s, order[i])) i++
      if (i >= order.length || cards.length === 0) {
        s.discard.push(...cards)
        return
      }
      now(
        s,
        ask(order[i], 'chaosPick', '真偽莫辨', '選一張蓋著的牌作為你的情報。', { kind: 'cards', zone: 'slots', owner: null, ids: cards.map((_, k) => k), min: 1, max: 1 }, false, {
          cards,
          order,
          i,
          user: d.user,
        }),
      )
      return
    }
    case 'laojinPlace': {
      const placed = d.placed as number[]
      const o = d.owner as number
      if (!isAlive(s, o) || !s.players[o].hand.length) return
      const seats = aliveSeats(s).filter((q) => !placed.includes(q))
      if (!seats.length) return
      now(s, ask(o, 'laojinPlaceTarget', '老金', '選一位玩家，在他面前放一張情報（從手牌），或結束。', { kind: 'player', seats }, true, { placed }))
      return
    }
  }
}

function answer(s: GameState, a: Ask, v: string | number | number[] | true | null) {
  const p = a.player
  const d = a.data
  const cards = Array.isArray(v) ? v : []
  const seat = typeof v === 'number' ? v : -1
  const opt = typeof v === 'string' ? v : ''
  const yes = v === true
  // 略過：除了禮服蒙面人（略過＝不救）以外都是什麼都不做
  if (v === null && a.step !== 'mengmianSave') return
  switch (a.step) {
    case 'probeDiscard':
      removeFromHand(s, p, cards[0])
      s.discard.push(cards[0])
      log(s, `${nm(s, p)} 棄了一張牌（暗棄）。`)
      break
    case 'chaosPick': {
      const deck = d.cards as number[]
      const [card] = deck.splice(cards[0], 1)
      obtain(s, p, card, { by: 'chaos', user: d.user as number })
      now(s, auto('chaosNext', { cards: deck, order: d.order, i: (d.i as number) + 1, user: d.user }))
      break
    }
    case 'dameinvReturn':
      removeFromHand(s, p, cards[0])
      s.deck.push(cards[0])
      log(s, `${nm(s, p)} 把一張手牌放回牌庫頂。`)
      break
    case 'laoguiHide': {
      const match = opt === 'truth' ? (d.match as boolean) : opt === 'match'
      if (opt !== 'truth') log(s, `${nm(s, p)} 隱瞞了身份。`, [p])
      probeEffect(s, p, d.card as number, match)
      break
    }
    case 'laoqiangFlip':
      if (yes && down(s, p, 'laoqiang')) {
        flipUp(s, p)
        draw(s, p, 2)
      }
      break
    case 'laojinFlip':
      if (yes && down(s, p, 'laojin')) {
        flipUp(s, p)
        draw(s, p, 5)
        if (s.players[p].hand.length)
          now(s, ask(p, 'laojinReturn', '老金', '選二張手牌放回牌庫頂（後選的那張在最上面）。', handPick(s, p, 2, 2), false))
      }
      break
    case 'laojinReturn':
      for (const c of cards) {
        removeFromHand(s, p, c)
        s.deck.push(c)
      }
      log(s, `${nm(s, p)} 把 ${cards.length} 張牌放回牌庫頂。`)
      break
    case 'yidianCover':
      if (yes && up(s, p, 'yidianyuan')) flipDown(s, p, '（譯電員自行蓋伏）')
      break
    case 'liujieTake':
      if (yes) takeRandom(s, p, d.from as number)
      break
    case 'chuzhang': {
      if (!yes) break
      draw(s, p, 1)
      const nonBlack = s.players[p].intel.filter((c) => s.cards[c].colour !== 'black')
      const options = [{ id: 'discard', label: '棄一張手牌' }]
      if (nonBlack.length) options.push({ id: 'burn', label: '燒毀自己一張非假情報' })
      now(s, ask(p, 'chuzhang2', '情報處長', '接著要：', { kind: 'options', options }, false))
      break
    }
    case 'chuzhang2':
      if (opt === 'burn') now(s, ask(p, 'chuzhangBurn', '情報處長', '選一張你的非假情報燒毀。', intelPick(s, p, 1, 1, (c) => c.colour !== 'black'), false))
      else if (s.players[p].hand.length) now(s, ask(p, 'chuzhangDiscard', '情報處長', '選一張手牌棄掉。', handPick(s, p, 1, 1), false))
      break
    case 'chuzhangDiscard':
      removeFromHand(s, p, cards[0])
      s.discard.push(cards[0])
      log(s, `${nm(s, p)} 棄了一張牌。`)
      break
    case 'chuzhangBurn':
      burnIntel(s, p, cards[0])
      break
    case 'qibaiGive':
      now(s, ask(p, 'qibaiGiveTo', '柒佰', '把這張牌交給誰？', { kind: 'player', seats: others(s, p) }, false, { card: cards[0] }))
      break
    case 'qibaiGiveTo':
      giveCard(s, p, d.card as number, seat)
      break
    case 'qibaiPick':
      finalize(s, p, d.why as 'faction' | 'mission', seat)
      break
    case 'mengmianDraw':
      if (yes) draw(s, p, 2)
      break
    case 'mengmianSave': {
      const dying = d.p as number
      delete (s.pendingKiller as Record<string, number | null>)[`save${dying}`]
      if (yes && up(s, p, 'mengmian') && isAlive(s, dying)) {
        s.players[p].identityRevealed = true
        log(s, `${nm(s, p)} 翻開身份牌：【${FACTION_NAME[s.players[p].faction]}】，救了 ${nm(s, dying)}！`)
        const blacks = s.players[dying].intel.filter((c) => s.cards[c].colour === 'black').slice(0, 2)
        for (const c of blacks) burnIntel(s, dying, c)
        delete s.pendingKiller[dying]
      } else if (isAlive(s, dying)) {
        kill(s, dying)
      }
      break
    }
    case 'laojinB': {
      if (!cards.length || !up(s, p, 'laojin')) break
      removeFromHand(s, p, cards[0])
      flipDown(s, p, '（老金自行蓋伏）')
      log(s, `${nm(s, p)} 放了一張假情報到自己面前。`)
      obtain(s, p, cards[0], { by: 'skill', user: p })
      now(s, auto('laojinPlace', { owner: p, placed: [] }))
      break
    }
    case 'laojinPlaceTarget':
      now(s, ask(p, 'laojinPlaceCard', '老金', `選一張手牌放到 ${nm(s, seat)} 面前。`, handPick(s, p, 1, 1), false, { to: seat, placed: d.placed }))
      break
    case 'laojinPlaceCard':
      place(s, p, cards[0], d.to as number)
      now(s, auto('laojinPlace', { owner: p, placed: [...(d.placed as number[]), d.to as number] }))
      break
    case 'xiaomaTarget':
      now(s, ask(p, 'xiaomaCard', '小馬哥', `選一張黑色手牌放到 ${nm(s, seat)} 面前。`, handPick(s, p, 1, 1, isBlack), false, { to: seat }))
      break
    case 'xiaomaCard':
      if (cards.length) place(s, p, cards[0], d.to as number)
      break
    case 'guaidaoTake':
      if (yes) takeRandom(s, p, d.from as number)
      break
    case 'shashouPlace':
      if (cards.length && isAlive(s, d.target as number)) place(s, p, cards[0], d.target as number)
      break
    case 'emeiBurn':
    case 'dameinvBurn': {
      if (!opt) break
      const [q, c] = opt.split(':').map(Number)
      if (a.step === 'dameinvBurn') {
        s.players[p].identityRevealed = true
        log(s, `${nm(s, p)} 翻開身份牌：【${FACTION_NAME[s.players[p].faction]}】`)
      }
      burnIntel(s, q, c)
      break
    }
    case 'liujieDeath':
      if (yes) takeRandom(s, p, d.dead as number, true)
      break
    case 'daofengDraw': {
      if (!yes) break
      draw(s, p, 2)
      const left = nextAlive(s, p, -1)
      if (left >= 0 && left !== p && s.players[p].hand.length)
        now(s, ask(p, 'daofengGive', '刀鋒', `選一張手牌交給左手邊的 ${nm(s, left)}。`, handPick(s, p, 1, 1), false, { to: left }))
      break
    }
    case 'daofengGive':
      giveCard(s, p, cards[0], d.to as number)
      break
    case 'laoguiGive': {
      if (seat < 0) break
      const hand = shuffle(s, [...s.players[p].hand])
      const taken = hand.slice(0, 3)
      log(s, `${nm(s, p)} 把手牌交給 ${nm(s, seat)}，他隨機選了 ${taken.length} 張作為情報。`)
      for (const c of taken) {
        removeFromHand(s, p, c)
        obtain(s, seat, c, { by: 'skill', user: p })
      }
      break
    }
    case 'shanlingTarget': {
      const intel = s.players[seat].intel
      if (intel.length <= 3) for (const c of [...intel]) burnIntel(s, seat, c)
      else now(s, ask(p, 'shanlingCards', '閃靈', `選擇 ${nm(s, seat)} 的三張情報燒毀。`, intelPick(s, seat, 3, 3), false, { target: seat }))
      break
    }
    case 'shanlingCards':
      for (const c of cards) burnIntel(s, d.target as number, c)
      break
    case 'heimeiguiTarget':
      now(
        s,
        ask(p, 'heimeiguiCards', '黑玫瑰', `選最多 ${d.n} 張黑色手牌放到 ${nm(s, seat)} 面前。`, handPick(s, p, 1, d.n as number, isBlack), true, { to: seat }),
      )
      break
    case 'heimeiguiCards':
      for (const c of cards) place(s, p, c, d.to as number)
      break
    case 'laoqiangCover': {
      if (seat < 0) break
      flipDown(s, p, '（老槍自行蓋伏）')
      flipDown(s, seat, `（被 ${nm(s, p)} 的老槍蓋伏）`)
      log(s, `${nm(s, p)} 和 ${nm(s, seat)} 互看了身份牌。`)
      log(s, `${nm(s, seat)} 的身份是【${FACTION_NAME[s.players[seat].faction]}】`, [p])
      log(s, `${nm(s, p)} 的身份是【${FACTION_NAME[s.players[p].faction]}】`, [seat])
      break
    }
    case 'xiaobaiTarget':
      if (seat < 0) break
      now(s, ask(p, 'xiaobaiGive', '小白', `選三張手牌交給 ${nm(s, seat)}。`, handPick(s, p, 3, 3), false, { to: seat }))
      break
    case 'xiaobaiGive': {
      const to = d.to as number
      for (const c of cards) {
        removeFromHand(s, p, c)
        s.players[to].hand.push(c)
      }
      log(s, `${nm(s, p)} 交給 ${nm(s, to)} 三張手牌。`)
      now(s, ask(p, 'xiaobaiTake', '小白', `選 ${nm(s, to)} 面前的一張情報拿走。`, intelPick(s, to, 1, 1), false, { from: to }))
      break
    }
    case 'xiaobaiTake': {
      const from = d.from as number
      s.players[from].intel = s.players[from].intel.filter((x) => x !== cards[0])
      log(s, `${nm(s, p)} 拿走了 ${nm(s, from)} 的 ${cardLabel(s, cards[0])}。`)
      obtain(s, p, cards[0], { by: 'skill', user: p })
      break
    }
    default:
      fail(`未知的步驟：${a.step}`)
  }
}

/** 檢查回答格式，回傳正規化後的值（略過為 null） */
function checkAnswer(a: Ask, act: Action): string | number | number[] | true | null {
  if (act.type === 'skip') {
    if (!a.canSkip) fail('這一步不能略過')
    return null
  }
  if (act.type !== 'answer') fail('請先回答目前的問題')
  const v = (act as { value: unknown }).value
  const c = a.choice
  switch (c.kind) {
    case 'confirm':
      if (v !== true) fail('請選擇是或略過')
      return true
    case 'options':
      if (typeof v !== 'string' || !c.options.some((o) => o.id === v)) fail('請選一個選項')
      return v as string
    case 'player':
      if (typeof v !== 'number' || !c.seats.includes(v)) fail('請選一位玩家')
      return v as number
    case 'cards': {
      if (!Array.isArray(v) || new Set(v).size !== v.length || v.some((x) => !c.ids.includes(x))) fail('請選擇正確的牌')
      const arr = v as number[]
      if (arr.length < c.min || arr.length > c.max) fail(c.min === c.max ? `請選 ${c.min} 張` : `請選 ${c.min}–${c.max} 張`)
      return arr
    }
  }
}

// ───────────────────────── 自動推進 ─────────────────────────

function stepTransmit(s: GameState): boolean {
  const t = s.trans!
  if (t.obtainedBy != null) {
    nextTurn(s)
    return true
  }
  if (s.window === 'hopA') {
    s.window = null
    const r = peekNext(s)
    t.toSender = false
    t.holder = r
    t.hops++
    t.stage = 'B'
    log(s, `情報傳到 ${nm(s, r)}。`)
    s.window = 'hopB'
    s.prio = { current: r, passes: 0 }
    return true
  }
  if (s.window === 'hopB') {
    s.window = null
    if (t.returned) {
      t.returned = false
      if (t.method === 'direct') t.toSender = true
      else t.dir = t.dir === 1 ? -1 : 1
      t.stage = 'hopStart'
      return true
    }
    t.stage = 'decide'
    if (!isAlive(s, t.holder)) {
      // 收件人在傳遞途中死了：直達回到傳出者，其他繼續傳
      if (t.method === 'direct') t.toSender = true
      t.stage = 'hopStart'
      return true
    }
    if (t.holder === t.sender || s.locks.includes(t.holder)) {
      log(s, t.holder === t.sender ? `情報回到傳出者，${nm(s, t.holder)} 必須接收。` : `${nm(s, t.holder)} 被鎖定，必須接收。`)
      t.obtainedBy = t.holder
      obtain(s, t.holder, t.card, { by: 'trans', sender: t.sender })
      return true
    }
    return false
  }
  if (t.stage === 'hopStart') {
    if (!isAlive(s, t.sender) && t.hops > 0 && peekNext(s) === t.sender) {
      log(s, '傳出者已經不在，情報無人接收，放入棄牌堆。')
      s.discard.push(t.card)
      t.obtainedBy = -1
      return true
    }
    t.stage = 'A'
    s.window = 'hopA'
    s.prio = { current: isAlive(s, s.active) ? s.active : nextAlive(s, s.active), passes: 0 }
    return true
  }
  return false
}

const hasAction = (s: GameState, p: number) => legalPlays(s, p).length > 0 || legalSkills(s, p).length > 0

function run(s: GameState) {
  for (let guard = 0; guard < 100000; guard++) {
    if (s.result || s.phase === 'choose_character') return
    if (s.q.length) {
      const head = s.q[0]
      if (head.k === 'ask') {
        if (!isAlive(s, head.player) && head.step !== 'laoguiGive' && head.step !== 'qibaiPick') {
          s.q.shift()
          continue
        }
        // 沒有可選的牌時自動略過
        if (head.choice.kind === 'cards' && head.choice.ids.length === 0) {
          s.q.shift()
          continue
        }
        return
      }
      s.q.shift()
      runAuto(s, head)
      continue
    }
    if (s.phase === 'over') return
    if (settle(s)) continue
    if (s.prio) {
      const p = s.prio.current
      if (p < 0) {
        s.prio = null
        continue
      }
      if (!isAlive(s, p)) {
        s.prio.current = nextAlive(s, p)
        continue
      }
      if (hasAction(s, p)) return
      doPass(s)
      continue
    }
    if (s.stack.length) {
      resolveTop(s)
      continue
    }
    if (s.reopenFrom != null) {
      const r = s.reopenFrom
      s.reopenFrom = null
      if (s.window) s.prio = { current: isAlive(s, r) ? r : nextAlive(s, r), passes: 0 }
      continue
    }
    if (s.phase === 'play') {
      if (!isAlive(s, s.active)) {
        nextTurn(s)
        continue
      }
      if (s.players[s.active].hand.length === 0) {
        eliminate(s, s.active, '無法傳出情報')
        nextTurn(s)
        continue
      }
      return
    }
    if (s.phase === 'transmit') {
      if (stepTransmit(s)) continue
      return
    }
    return
  }
  throw new Error('引擎推進次數過多（可能有無限迴圈）')
}

function doPass(s: GameState) {
  const pr = s.prio!
  pr.passes++
  if (pr.passes >= aliveSeats(s).length) s.prio = null
  else pr.current = nextAlive(s, pr.current)
}

// ───────────────────────── 對外 API ─────────────────────────

export function getDecisions(s: GameState): Decision[] {
  if (s.result) return []
  if (s.phase === 'choose_character')
    return s.players.filter((pl) => !pl.character).map((pl) => ({ type: 'choose_character', player: pl.seat, options: pl.charOptions }))
  const head = s.q[0]
  if (head?.k === 'ask') {
    const { player, title, prompt, choice, canSkip } = head
    return [{ type: 'ask', player, ask: { player, title, prompt, choice, canSkip } }]
  }
  if (s.q.length) return []
  if (s.prio) return [{ type: 'priority', player: s.prio.current, ctx: currentCtx(s) }]
  if (s.phase === 'transmit' && s.trans?.stage === 'decide') return [{ type: 'accept', player: s.trans.holder }]
  if (s.phase === 'play') return [{ type: 'play', player: s.active }]
  return []
}

/** 套用一個動作，回傳新的狀態（不修改傳入的狀態） */
export function applyAction(state: GameState, p: number, a: Action): GameState {
  const s: GameState = structuredClone(state)
  const dec = getDecisions(s).find((d) => d.player === p)
  if (!dec) fail('現在不是你的行動時機')
  const pl = s.players[p]

  switch (dec!.type) {
    case 'choose_character': {
      if (a.type !== 'choose_character' || !pl.charOptions.includes(a.character)) fail('請從兩張角色中選一張')
      pl.character = (a as { character: string }).character
      if (s.players.every((x) => x.character)) afterCharacters(s)
      break
    }
    case 'ask': {
      const head = s.q[0] as Ask
      const v = checkAnswer(head, a)
      s.q.shift()
      answer(s, head, v)
      break
    }
    case 'accept': {
      const t = s.trans!
      if (a.type === 'accept') {
        t.obtainedBy = p
        obtain(s, p, t.card, { by: 'trans', sender: t.sender })
      } else if (a.type === 'decline') {
        log(s, `${pl.name} 不接收。`)
        if (t.method === 'direct') t.toSender = true
        t.stage = 'hopStart'
      } else fail('請選擇接收或不接收')
      break
    }
    case 'priority':
    case 'play': {
      if (a.type === 'pass') {
        if (dec!.type === 'play') fail('出牌階段必須傳出一張情報')
        doPass(s)
        break
      }
      if (a.type === 'use_skill') {
        if (!legalSkills(s, p).some((x) => x.id === a.skill)) fail('這個技能現在不能發動')
        const wasPrio = !!s.prio
        useSkill(s, p, a.skill)
        // 發動技能後，其他人可以重新回應
        if (wasPrio && s.prio) s.prio = { current: nextAlive(s, p), passes: 0 }
        break
      }
      if (a.type === 'send') {
        if (dec!.type !== 'play') fail('現在不能傳情報')
        if (!pl.hand.includes(a.card)) fail('這張牌不在你手上')
        const c = s.cards[a.card]
        if (c.method === 'direct') {
          if (a.target == null || a.target === p || !isAlive(s, a.target)) fail('直達情報要指定另一位存活的玩家')
        }
        const dir: 1 | -1 = a.dir === -1 && c.method !== 'direct' && up(s, p, 'beileimao') ? -1 : 1
        removeFromHand(s, p, a.card)
        s.trans = {
          card: a.card,
          sender: p,
          method: c.method,
          dir,
          holder: p,
          target: c.method === 'direct' ? a.target! : null,
          stage: 'hopStart',
          peeked: [p],
          toSender: false,
          returned: false,
          obtainedBy: null,
          hops: 0,
        }
        s.phase = 'transmit'
        const face = c.method === 'text' ? `：${cardLabel(s, a.card)}` : ''
        const to = c.method === 'direct' ? `給 ${nm(s, a.target!)}` : dir === -1 ? '（貝雷帽：反方向傳遞）' : ''
        log(s, `${pl.name} 以【${METHOD_NAME[c.method]}】傳出情報${to}${face}`)
        break
      }
      if (a.type === 'play_card') {
        const pa = a
        const ctx = currentCtx(s)
        const want = pa.as ?? s.cards[pa.card]?.kind
        const lp = legalPlays(s, p, ctx).find((x) => x.card === pa.card && x.kind === want)
        if (!lp) fail('這張牌現在不能這樣使用')
        const play = lp as LegalPlay
        let target = pa.target
        let ref = pa.targetRef
        if (play.targets && (target == null || !play.targets.includes(target))) fail('請選擇合法的目標')
        if (play.refs && !play.refs.some((r) => r.ref === ref && r.target === target)) {
          if (play.refs.length === 1 && play.kind === 'counter') {
            target = play.refs[0].target
            ref = play.refs[0].ref
          } else fail('請選擇要作用的對象')
        }
        pushStack(s, p, play, target, ref)
        break
      }
      fail('無效的動作')
    }
  }
  run(s)
  return s
}

/** 測試用：直接推進流程 */
export function advance(s: GameState) {
  run(s)
}

export function startGame(config: GameConfig): GameState {
  const s = createGame(config)
  run(s)
  return s
}
