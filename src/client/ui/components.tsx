import { CHAR_BY_ID, COLOUR_NAME, FACTION_NAME, KIND_DESC, KIND_NAME, METHOD_NAME } from '../../engine/data'
import type { Card, Faction, Method } from '../../engine/types'
import type { PublicPlayer } from '../../engine/view'

export const SEAL: Record<Method, string> = { secret: '密', direct: '直', text: '文' }

export function CardFace({
  card,
  selected,
  usable,
  onClick,
  small,
}: {
  card: Card
  selected?: boolean
  usable?: boolean
  onClick?: () => void
  small?: boolean
}) {
  const cls = ['card', `c-${card.colour}`, selected && 'is-selected', usable && 'is-usable', small && 'is-small']
    .filter(Boolean)
    .join(' ')
  const label = `${COLOUR_NAME[card.colour]}色·${KIND_NAME[card.kind]}·${METHOD_NAME[card.method]}`
  const inner = (
    <>
      <span className="card-band" />
      <span className="card-seal" title={METHOD_NAME[card.method]}>
        {SEAL[card.method]}
      </span>
      <span className="card-name">{KIND_NAME[card.kind]}</span>
      {!small && <span className="card-colour">{card.colour === 'black' ? '假情報' : `${COLOUR_NAME[card.colour]}色情報`}</span>}
    </>
  )
  if (!onClick)
    return (
      <div className={cls} title={`${label}\n${KIND_DESC[card.kind]}`}>
        {inner}
      </div>
    )
  return (
    <button type="button" className={cls} onClick={onClick} title={`${label}\n${KIND_DESC[card.kind]}`} aria-pressed={selected}>
      {inner}
    </button>
  )
}

export function IntelChip({ card }: { card: Card }) {
  return (
    <span className={`chip c-${card.colour}`} title={`${COLOUR_NAME[card.colour]}色情報（${KIND_NAME[card.kind]}）`}>
      {KIND_NAME[card.kind].slice(0, 2)}
    </span>
  )
}

export function FactionBadge({ faction }: { faction: Faction }) {
  return <span className={`faction f-${faction}`}>{FACTION_NAME[faction]}</span>
}

export function Seat({
  p,
  me,
  active,
  holding,
  locked,
  diverted,
  waiting,
  winner,
  aiControlled,
  style,
}: {
  p: PublicPlayer
  me: boolean
  active: boolean
  holding: boolean
  locked: boolean
  diverted: boolean
  waiting: boolean
  winner: boolean
  aiControlled?: boolean
  style?: React.CSSProperties
}) {
  const ch = p.character ? CHAR_BY_ID[p.character] : null
  const cls = [
    'seat',
    me && 'is-me',
    active && 'is-active',
    holding && 'is-holding',
    p.status !== 'alive' && 'is-out',
    waiting && 'is-waiting',
    winner && 'is-winner',
  ]
    .filter(Boolean)
    .join(' ')
  const charLabel = ch ? `${ch.name}${p.charFaceUp ? '' : '（蓋伏）'}` : '角色蓋伏'
  return (
    <div className={cls} style={style} data-seat={p.seat}>
      <div className="seat-head">
        <span className="seat-name">
          {p.name}
          {me && <span className="seat-you">你</span>}
          {p.isAI && <span className="seat-ai">電腦</span>}
        </span>
        <span className="seat-hand" title="手牌數">
          手牌 {p.handCount}
        </span>
      </div>
      <div className="seat-char" title={ch ? `任務：${ch.missionText}` : '這位玩家的角色目前是蓋伏狀態'}>
        {charLabel}
        {p.faction && <FactionBadge faction={p.faction} />}
      </div>
      <div className="seat-intel">
        {p.intel.length === 0 ? <span className="seat-empty">尚無情報</span> : p.intel.map((c) => <IntelChip key={c.id} card={c} />)}
      </div>
      <div className="seat-marks">
        {p.status === 'dead' && <span className="mark m-dead">死亡</span>}
        {p.status === 'out' && <span className="mark m-dead">出局</span>}
        {active && p.status === 'alive' && <span className="mark m-turn">回合中</span>}
        {locked && <span className="mark m-lock">鎖定</span>}
        {diverted && <span className="mark m-divert">調虎離山</span>}
        {holding && <span className="mark m-hold">情報在此</span>}
        {waiting && <span className="mark m-wait">行動中</span>}
        {aiControlled && p.status === 'alive' && <span className="mark m-ai">斷線．AI 代打</span>}
      </div>
    </div>
  )
}
