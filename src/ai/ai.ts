import { CHAR_BY_ID } from '../engine/data'
import type { Action, AskView, Card, CardKind, LegalPlay } from '../engine/types'
import type { GameView } from '../engine/view'

// 規則式 AI：只看得到自己的 GameView（和真人玩家一樣），不偷看。

const KEEP: Record<CardKind, number> = {
  counter: 5,
  burn: 4,
  intercept: 3,
  lock: 3,
  decrypt: 2,
  return: 2,
  divert: 2,
  probe: 1,
  chaos: 0,
}

const rnd = Math.random
const blackOf = (cards: Card[]) => cards.filter((c) => c.colour === 'black').length
const colourOf = (cards: Card[], col: Card['colour']) => cards.filter((c) => c.colour === col).length

/** 猜測對方是隊友(>0)或敵人(<0)：看他面前收了哪種顏色的情報 */
function allyScore(v: GameView, q: number): number {
  const me = v.players[v.me]
  if (q === v.me) return 99
  const f = me.faction
  if (f !== 'red' && f !== 'blue') return 0
  const other = f === 'red' ? 'blue' : 'red'
  const p = v.players[q]
  return colourOf(p.intel, f) - colourOf(p.intel, other)
}

function myColour(v: GameView): 'red' | 'blue' | null {
  const f = v.players[v.me].faction
  return f === 'red' || f === 'blue' ? f : null
}

/** 這張情報我想不想要 */
function wantCard(v: GameView, c: Card): number {
  const me = v.players[v.me]
  const bl = blackOf(me.intel)
  if (c.colour === 'black') return bl >= 2 ? -10 : bl === 1 ? -3 : -1.5
  const mc = myColour(v)
  if (mc) return c.colour === mc ? 3 + colourOf(me.intel, mc) : -0.8
  // 特工：看機密任務
  const m = me.character ? CHAR_BY_ID[me.character].mission : null
  if (m?.type === 'intel') return c.colour === m.colour ? 3 : 0.2
  if (m?.type === 'nonBlack' || m?.type === 'totalIntel') return 2
  return 0.3
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)]
}

function find(legal: LegalPlay[], kind: CardKind) {
  // 優先用原本就是這種牌的，再用「當作」的
  return legal.find((l) => l.kind === kind && !l.as) ?? legal.find((l) => l.kind === kind)
}

const play = (l: LegalPlay, target?: number, targetRef?: number): Action => ({
  type: 'play_card',
  card: l.card,
  target,
  targetRef,
  as: l.as ? l.kind : undefined,
})

function burnSelfOrAlly(v: GameView, legal: LegalPlay[]): Action | null {
  const b = find(legal, 'burn')
  if (!b?.refs) return null
  const me = v.players[v.me]
  if (blackOf(me.intel) >= 2) {
    const r = b.refs.find((x) => x.target === v.me)
    if (r) return play(b, r.target, r.ref)
  }
  for (const r of b.refs) {
    if (r.target !== v.me && allyScore(v, r.target) >= 2 && blackOf(v.players[r.target].intel) >= 2)
      return play(b, r.target, r.ref)
  }
  return null
}

function enemies(v: GameView) {
  return v.players
    .filter((p) => p.seat !== v.me && p.status === 'alive')
    .sort((a, b) => allyScore(v, a.seat) - allyScore(v, b.seat))
}

function decidePlay(v: GameView): Action {
  const legal = v.legal
  const me = v.players[v.me]
  const sk = decideSkill(v)
  if (sk) return sk
  const burn = burnSelfOrAlly(v, legal)
  if (burn) return burn

  const probe = find(legal, 'probe')
  if (probe?.targets && v.hand.length > 2 && rnd() < 0.3) {
    return play(probe, pick(probe.targets))
  }
  const chaos = find(legal, 'chaos')
  if (chaos && blackOf(me.intel) === 0 && rnd() < 0.25) return play(chaos)

  const hand = v.hand
  const others = enemies(v)
  const worst = others[0]
  const best = [...others].reverse().find((p) => allyScore(v, p.seat) > 0)

  // 有人被我鎖定 → 把假情報直達給他
  const locked = v.locks.find((q) => v.players[q].status === 'alive')
  const blackDirect = hand.filter((c) => c.colour === 'black' && c.method === 'direct')
  if (locked != null && blackDirect.length) {
    return { type: 'send', card: cheapest(blackDirect).id, target: locked }
  }
  // 先鎖定最可疑的敵人，再傳假情報
  const lock = find(legal, 'lock')
  if (lock?.targets && worst && blackDirect.some((c) => c.id !== lock.card) && allyScore(v, worst.seat) < 0 && rnd() < 0.7) {
    return play(lock, worst.seat)
  }

  const mc = myColour(v)
  const options: { card: Card; target?: number; score: number }[] = []
  for (const c of hand) {
    const keep = KEEP[c.kind]
    if (c.method === 'direct') {
      for (const p of others) {
        const as = allyScore(v, p.seat)
        let sc = 0
        if (c.colour === 'black') sc = -as + 1 - blackOf(p.intel) * -0.5
        else if (mc && c.colour === mc) sc = as > 0 ? 3 + as : 1.5 // 傳給敵人多半會被退回自己
        else if (mc) sc = as < 0 ? 0.5 : -1
        else sc = 0.5
        options.push({ card: c, target: p.seat, score: sc - keep * 0.6 + rnd() * 0.5 })
      }
    } else {
      let sc = 0
      if (c.colour === 'black') sc = 0.5
      else if (mc && c.colour === mc) sc = 1
      else sc = 0.2
      if (c.method === 'text' && c.colour === 'black') sc -= 0.3
      options.push({ card: c, score: sc - keep * 0.6 + rnd() * 0.5 })
    }
  }
  options.sort((a, b) => b.score - a.score)
  const choice = options[0] ?? { card: hand[0], target: others[0]?.seat }
  void best
  return { type: 'send', card: choice.card.id, target: choice.target }
}

function cheapest(cards: Card[]): Card {
  return [...cards].sort((a, b) => KEEP[a.kind] - KEEP[b.kind])[0]
}

function decidePriority(v: GameView): Action {
  const legal = v.legal
  const ctx = v.decision!.type === 'priority' ? v.decision!.ctx : 'play'
  const t = v.trans
  const me = v.players[v.me]

  if (ctx === 'resp') {
    const c = find(legal, 'counter')
    const top = v.stack[v.stack.length - 1]
    if (c && top) {
      const below = top.kind === 'counter' ? v.stack.find((x) => x.uid === top.targetRef) : null
      let want = 0
      if (top.target === v.me && (top.kind === 'lock' || top.kind === 'probe')) want = 0.55
      if (below && below.user === v.me) want = 0.85
      if (below && below.user !== v.me && allyScore(v, below.user) >= 2) want = 0.4
      if (top.kind === 'intercept' && t?.card && wantCard(v, t.card) > 1) want = 0.8
      if (top.kind === 'burn' && top.target !== v.me && allyScore(v, top.target!) < -1) want = 0.4
      if (rnd() < want) return play(c, top.user, top.uid)
    }
    return { type: 'pass' }
  }

  const sk = decideSkill(v)
  if (sk) return sk

  const burn = burnSelfOrAlly(v, legal)
  if (burn) return burn

  if (ctx === 'hopA' && t) {
    const lock = find(legal, 'lock')
    if (lock?.targets && t.card && t.next !== v.me && lock.targets.includes(t.next)) {
      const as = allyScore(v, t.next)
      if ((t.card.colour === 'black' && as < 0 && rnd() < 0.6) || (myColour(v) === t.card.colour && as > 0 && rnd() < 0.6))
        return play(lock, t.next)
    }
    const ic = find(legal, 'intercept')
    if (ic && t.card && wantCard(v, t.card) > 1.5 && rnd() < 0.8) return play(ic)
    const dv = find(legal, 'divert')
    if (dv?.targets && t.next === v.me && dv.targets.includes(v.me)) {
      const w = t.card ? wantCard(v, t.card) : blackOf(me.intel) >= 2 ? -5 : 0
      if (w < -2) return play(dv, v.me)
    }
  }
  if (ctx === 'hopB' && t && t.holder === v.me) {
    const dc = find(legal, 'decrypt')
    if (dc && !t.card && (blackOf(me.intel) >= 1 || rnd() < 0.4)) return play(dc)
    const rt = find(legal, 'return')
    if (rt && t.card && wantCard(v, t.card) < -1 && rnd() < 0.8) return play(rt)
    if (rt && !t.card && blackOf(me.intel) >= 2 && rnd() < 0.6) return play(rt)
  }
  return { type: 'pass' }
}

function decideAccept(v: GameView): Action {
  const t = v.trans!
  const me = v.players[v.me]
  if (t.card) return wantCard(v, t.card) > 0 ? { type: 'accept' } : { type: 'decline' }
  const bl = blackOf(me.intel)
  let p = [0.45, 0.25, 0.04][Math.min(bl, 2)]
  const as = allyScore(v, t.sender)
  if (as > 0) p += 0.25
  if (as < 0) p -= 0.15
  if (t.method === 'direct' && as < 0) p -= 0.1
  return rnd() < p ? { type: 'accept' } : { type: 'decline' }
}

export function decide(v: GameView): Action {
  const d = v.decision
  if (!d) throw new Error('AI 沒有需要做的決定')
  switch (d.type) {
    case 'choose_character':
      return { type: 'choose_character', character: pick(d.options) }
    case 'play':
      return decidePlay(v)
    case 'priority':
      return decidePriority(v)
    case 'accept':
      return decideAccept(v)
    case 'ask':
      return decideAsk(v, d.ask)
  }
}

// ───────── 角色技能 ─────────

function decideSkill(v: GameView): Action | null {
  const me = v.players[v.me]
  const use = (id: string): Action => ({ type: 'use_skill', skill: id })
  for (const s of v.skills) {
    switch (s.id) {
      case 'dameinv':
        if (blackOf(me.intel) >= 2) return use(s.id)
        break
      case 'shanling':
        if (v.players.some((p) => p.seat !== v.me && p.status === 'alive' && allyScore(v, p.seat) <= -2 && p.intel.length >= 2) && rnd() < 0.6)
          return use(s.id)
        break
      case 'heimeigui':
        if (v.hand.some((c) => c.colour === 'black') && enemies(v).some((p) => allyScore(v, p.seat) < 0) && rnd() < 0.15) return use(s.id)
        break
      case 'emeifeng':
        if (s.label.includes('截獲這份') && v.trans?.card && wantCard(v, v.trans.card) > 1.5) return use(s.id)
        break
      case 'yidian':
        if (rnd() < 0.7) return use(s.id)
        break
      case 'xiaobai':
        if (v.hand.length >= 5 && rnd() < 0.05) return use(s.id)
        break
      case 'laoqiang':
        if (rnd() < 0.03) return use(s.id)
        break
    }
  }
  return null
}

const HELPFUL_TARGET = ['老鬼', '柒佰', '刀鋒']
const SKIP_PLAYER = ['老金']

function decideAsk(v: GameView, a: AskView): Action {
  const c = a.choice
  const yes: Action = { type: 'answer', value: true }
  const skip: Action = { type: 'skip' }
  switch (c.kind) {
    case 'confirm':
      if (a.title === '譯電員') return skip
      if (a.title === '禮服蒙面人' && a.prompt.includes('救')) return rnd() < 0.6 ? yes : skip
      return yes
    case 'options': {
      if (a.title === '老鬼') return { type: 'answer', value: 'miss' }
      if (a.title === '情報處長') return { type: 'answer', value: 'discard' }
      const burns = c.options.map((o) => ({ o, owner: Number(o.id.split(':')[0]) }))
      if (burns.every((b) => Number.isFinite(b.owner))) {
        const best = [...burns].sort((x, y) => allyScore(v, y.owner) - allyScore(v, x.owner))[0]
        return { type: 'answer', value: best.o.id }
      }
      return { type: 'answer', value: c.options[0].id }
    }
    case 'player': {
      if (a.canSkip && SKIP_PLAYER.includes(a.title)) return skip
      const seats = [...c.seats].sort((x, y) => allyScore(v, x) - allyScore(v, y))
      if (HELPFUL_TARGET.includes(a.title)) return { type: 'answer', value: seats[seats.length - 1] }
      if (a.title === '小白' || a.title === '老槍') return { type: 'answer', value: pick(c.seats) }
      // 其他（閃靈、黑玫瑰、小馬哥…）都是對敵人不利的
      const harm = seats.filter((q) => q !== v.me)
      return { type: 'answer', value: harm[0] ?? seats[0] }
    }
    case 'cards': {
      if (c.zone === 'slots') return { type: 'answer', value: [pick(c.ids)] }
      if (c.zone === 'hand') {
        if (a.canSkip && a.title === '老金') return skip
        const cards = c.ids.map((id) => v.hand.find((h) => h.id === id)!).filter(Boolean)
        cards.sort((x, y) => KEEP[x.kind] - KEEP[y.kind])
        const n = a.title === '黑玫瑰' ? c.max : c.min || 1
        return { type: 'answer', value: cards.slice(0, Math.max(c.min, Math.min(n, c.max))).map((x) => x.id) }
      }
      // 情報：拿自己的顏色、燒對手的顏色
      const owner = c.owner ?? v.me
      const intel = v.players[owner].intel.filter((x) => c.ids.includes(x.id))
      const mc = myColour(v)
      const score = (x: Card) => {
        if (owner === v.me) return x.colour === 'black' ? 0 : x.colour === mc ? 2 : 1 // 處長燒自己的：先燒不需要的
        if (a.title === '小白') return x.colour === mc ? -2 : x.colour === 'black' ? 5 : 0
        return x.colour === 'black' ? 3 : x.colour === mc ? 2 : 0 // 閃靈：先燒對手需要的顏色
      }
      intel.sort((x, y) => score(x) - score(y))
      return { type: 'answer', value: intel.slice(0, c.min).map((x) => x.id) }
    }
  }
}
