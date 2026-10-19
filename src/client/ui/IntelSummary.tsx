import { KIND_NAME } from '../../engine/data'
import type { Card } from '../../engine/types'
import type { GameView } from '../../engine/view'

const count = (cards: Card[], c: Card['colour']) => cards.filter((x) => x.colour === c).length

/** 一位玩家面前的情報：紅／藍／假各幾張，以及每一張的小方塊 */
export function IntelSummary({ cards }: { cards: Card[] }) {
  if (!cards.length) return <div className="intel-sum is-empty">尚無情報</div>
  const r = count(cards, 'red')
  const b = count(cards, 'blue')
  const k = count(cards, 'black')
  return (
    <div className="intel-sum">
      <span className="intel-counts" aria-label={`紅 ${r} 張、藍 ${b} 張、假 ${k} 張`}>
        <b className="ic-red">紅 {r}</b>
        <b className="ic-blue">藍 {b}</b>
        <b className={`ic-black ${k >= 2 ? 'is-danger' : ''}`}>假 {k}</b>
      </span>
      <span className="intel-chips">
        {cards.map((c) => (
          <span key={c.id} className={`chip c-${c.colour}`} title={KIND_NAME[c.kind]}>
            {KIND_NAME[c.kind].slice(0, 2)}
          </span>
        ))}
      </span>
    </div>
  )
}

/** 側欄：所有人的情報總覽，一眼比較誰快集滿了 */
export function IntelBoard({ v }: { v: GameView }) {
  return (
    <section className="intel-board" aria-label="各人情報">
      <h3>各人情報</h3>
      <ul>
        {v.players.map((p) => (
          <li key={p.seat} className={p.status !== 'alive' ? 'is-out' : ''}>
            <span className="ib-name">
              {p.name}
              {p.seat === v.me && <span className="seat-you">你</span>}
              {p.status === 'dead' && <span className="muted">（死亡）</span>}
              {p.status === 'out' && <span className="muted">（出局）</span>}
            </span>
            <IntelSummary cards={p.intel} />
          </li>
        ))}
      </ul>
    </section>
  )
}
