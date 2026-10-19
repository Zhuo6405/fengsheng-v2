import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CHAR_BY_ID, COLOUR_NAME, FACTION_NAME, KIND_DESC, KIND_NAME, METHOD_NAME } from '../../engine/data'
import type { Action, AskView, Card, GameConfig, LegalPlay } from '../../engine/types'
import type { GameView } from '../../engine/view'
import { CardFace, FactionBadge, IntelChip, SEAL } from './components'
import { useLocalController, useSecondsLeft, type GameController, type Social } from './controller'
import { DocsButtons } from './Docs'
import { recordResult } from './history'
import { ChatPanel, VoiceControls } from './social'

// 3D 場景比較大，進牌桌時才載入
const TableScene = lazy(() => import('../three/TableScene').then((m) => ({ default: m.TableScene })))

export function LocalGame({ config, onExit }: { config: GameConfig; onExit: () => void }) {
  const ctl = useLocalController(config)
  return (
    <GameScreen
      ctl={ctl}
      onExit={onExit}
      historyId={`local-${config.seed}`}
      resultActions={
        <button type="button" className="primary" onClick={onExit}>
          回到大廳
        </button>
      }
    />
  )
}

export function GameScreen({
  ctl,
  social,
  onExit,
  exitLabel = '離開',
  resultActions,
  historyId,
  topExtra,
}: {
  ctl: GameController
  social?: Social
  onExit: () => void
  exitLabel?: string
  resultActions: ReactNode
  historyId: string
  topExtra?: ReactNode
}) {
  const v = ctl.view
  useEffect(() => {
    if (v.result) recordResult(v, social ? 'online' : 'local', historyId)
  }, [v, social, historyId])
  if (v.phase === 'choose_character' && v.decision?.type === 'choose_character') {
    return <CharacterPick v={v} act={ctl.act} deadline={ctl.deadline} />
  }
  if (v.phase === 'choose_character') {
    return (
      <main className="pick">
        <p className="pick-wait">等待其他玩家挑選角色…</p>
      </main>
    )
  }
  return <Table ctl={ctl} social={social} onExit={onExit} exitLabel={exitLabel} resultActions={resultActions} topExtra={topExtra} />
}

function CharacterPick({ v, act, deadline }: { v: GameView; act: (a: Action) => void; deadline: number | null }) {
  const left = useSecondsLeft(deadline)
  return (
    <main className="pick">
      <h1>挑選你的角色</h1>
      <p className="pick-sub">
        選完角色後才會發身份牌。潛伏角色開局蓋伏，其他角色公開。
        {left != null && <span className="countdown">剩 {left} 秒</span>}
      </p>
      <div className="pick-row">
        {v.myCharOptions.map((id) => {
          const c = CHAR_BY_ID[id]
          return (
            <button key={id} type="button" className="char-card" onClick={() => act({ type: 'choose_character', character: id })}>
              <span className="char-name">{c.name}</span>
              <span className="char-meta">
                {c.hidden ? '潛伏角色．開局蓋伏' : '公開角色'}．{c.gender === 'male' ? '男' : c.gender === 'female' ? '女' : '男女皆是'}
              </span>
              <span className="char-sec">機密任務</span>
              <span className="char-text">{c.missionText}</span>
              <span className="char-sec">角色技能</span>
              <ul>
                {c.skills.map((sk) => (
                  <li key={sk}>{sk}</li>
                ))}
              </ul>
              <span className="char-go">選擇{c.name}</span>
            </button>
          )
        })}
      </div>
    </main>
  )
}

/** 「本回合都略過」：自動略過與自己無關的回應時機 */
function useAutoSkip(v: GameView, act: (a: Action) => void) {
  const [skipTurn, setSkipTurn] = useState<number | null>(null)
  const d = v.decision
  const skipping = skipTurn === v.turnNo
  useEffect(() => {
    if (!skipping || d?.type !== 'priority') return
    const top = v.stack[v.stack.length - 1]
    const aboutMe = (d.ctx === 'hopB' && v.trans?.holder === v.me) || (top && top.target === v.me)
    if (aboutMe) return
    const id = setTimeout(() => act({ type: 'pass' }), 150)
    return () => clearTimeout(id)
  }, [skipping, d, v, act])
  return { skipping, skip: () => setSkipTurn(v.turnNo), stop: () => setSkipTurn(null) }
}

type Skip = ReturnType<typeof useAutoSkip>

function Table({
  ctl,
  social,
  onExit,
  exitLabel,
  resultActions,
  topExtra,
}: {
  ctl: GameController
  social?: Social
  onExit: () => void
  exitLabel: string
  resultActions: ReactNode
  topExtra?: ReactNode
}) {
  const v = ctl.view
  const [sel, setSel] = useState<number | null>(null)
  const [tab, setTab] = useState<'log' | 'chat'>('log')
  const [seenChat, setSeenChat] = useState(0)
  const [sideOpen, setSideOpen] = useState(false)
  const me = v.players[v.me]
  const myChar = me.character ? CHAR_BY_ID[me.character] : null
  const d = v.decision
  const skip = useAutoSkip(v, ctl.act)
  const myMove = !!d && d.type !== 'priority'
  const myAny = !!d

  // 分頁標題提示：輪到你時，切到別的分頁也看得到
  useEffect(() => {
    const base = '風聲'
    document.title = v.result ? base : myMove ? '● 輪到你了｜風聲' : myAny ? '● 可以回應｜風聲' : base
    return () => {
      document.title = base
    }
  }, [myMove, myAny, v.result])

  // 手牌變動或時機改變時，取消選取
  const askNow = d?.type === 'ask' ? d.ask : null
  const decKey = `${d?.type}-${v.turnNo}-${v.stack.length}-${v.trans?.stage}-${v.trans?.holder}-${askNow?.prompt ?? ''}`
  const [picked, setPicked] = useState<number[]>([])
  useEffect(() => {
    setSel(null)
    setPicked([])
  }, [decKey])
  const selCard = v.hand.find((c) => c.id === sel) ?? null
  const legalById = useMemo(() => {
    const m = new Map<number, LegalPlay[]>()
    for (const l of v.legal) m.set(l.card, [...(m.get(l.card) ?? []), l])
    return m
  }, [v.legal])
  // 技能要從手牌選牌時，手牌改成多選
  const handAsk = askNow && askNow.choice.kind === 'cards' && askNow.choice.zone === 'hand' ? askNow.choice : null
  const clickCard = (id: number) => {
    if (handAsk) {
      if (!handAsk.ids.includes(id)) return
      setPicked((ps) => (ps.includes(id) ? ps.filter((x) => x !== id) : handAsk.max === 1 ? [id] : ps.length < handAsk.max ? [...ps, id] : ps))
      return
    }
    setSel(sel === id ? null : id)
  }

  const chatLen = social?.chat.length ?? 0
  useEffect(() => {
    if (tab === 'chat') setSeenChat(chatLen)
  }, [tab, chatLen])
  const unread = Math.max(0, chatLen - seenChat)

  return (
    <div className="game">
      <header className="topbar">
        <span className="brand">風聲</span>
        <span className="turn">
          第 {v.turnNo} 回合
          <b className={v.active === v.me ? 'turn-me' : ''}>{v.active === v.me ? '你的回合' : `${v.players[v.active].name} 的回合`}</b>
        </span>
        {social && <VoiceControls voice={social.voice} speakers={social.room.members.filter((m) => m.inVoice).length} />}
        {topExtra}
        <DocsButtons />
        <button type="button" className="ghost side-toggle" onClick={() => setSideOpen((o) => !o)} aria-expanded={sideOpen}>
          {sideOpen ? '收起' : '紀錄與聊天'}
          {unread > 0 && <span className="badge">{unread}</span>}
        </button>
        <button type="button" className="ghost" onClick={onExit}>
          {exitLabel}
        </button>
      </header>

      <div className="layout">
        <section className="stage" aria-label="牌桌（可拖曳旋轉視角）">
          <Suspense fallback={<div className="stage-loading">牌桌佈置中…</div>}>
            <TableScene v={v} waitingOn={ctl.waitingOn} aiControlled={ctl.aiControlled} />
          </Suspense>
          <div className="stage-hud">
            <Centre v={v} />
            <p className="stage-piles">牌庫 {v.deckCount}．棄牌 {v.discardCount}．可拖曳旋轉視角</p>
          </div>
        </section>

        <aside className={`side ${sideOpen ? 'is-open' : ''}`}>
          <div className="me-card">
            <div className="me-row">
              {me.faction && <FactionBadge faction={me.faction} />}
              <b>{myChar?.name ?? '—'}</b>
              {myChar && !me.charFaceUp && <span className="muted">蓋伏中</span>}
            </div>
            {myChar && (
              <p className="me-mission">
                {me.faction === 'neutral' ? '你的勝利條件：' : '機密任務（身份是特工時才生效）：'}
                {myChar.missionText}
              </p>
            )}
            {me.faction && me.faction !== 'neutral' && (
              <p className="me-mission">
                你的勝利條件：你或隊友集滿三張{me.faction === 'red' ? '紅色' : '藍色'}情報。
              </p>
            )}
            {myChar && (
              <details className="me-skills">
                <summary>角色技能{!me.charFaceUp && myChar.hidden ? '（蓋伏中只能用「翻開」的技能）' : !me.charFaceUp ? '（被蓋伏，技能失效）' : ''}</summary>
                <ul>
                  {myChar.skills.map((sk) => (
                    <li key={sk}>{sk}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
          {social && (
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>
                遊戲紀錄
              </button>
              <button type="button" role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
                聊天{unread > 0 && <span className="badge">{unread}</span>}
              </button>
            </div>
          )}
          {social && tab === 'chat' ? <ChatPanel chat={social.chat} me={social.me} say={social.say} /> : <Log v={v} />}
        </aside>
      </div>

      <section className={`bench ${myMove ? 'is-my-move' : myAny ? 'is-my-chance' : ''}`} aria-label="你的手牌與行動">
        <Prompt
          v={v}
          ctl={ctl}
          skip={skip}
          selCard={selCard}
          legal={selCard ? legalById.get(selCard.id) ?? [] : []}
          picked={picked}
          setPicked={setPicked}
          clear={() => {
            setSel(null)
            setPicked([])
          }}
        />
        <div className="hand" role="group" aria-label="手牌">
          {v.hand.length === 0 && <span className="muted">沒有手牌</span>}
          {v.hand.map((c) => (
            <CardFace
              key={c.id}
              card={c}
              selected={sel === c.id || picked.includes(c.id)}
              usable={handAsk ? handAsk.ids.includes(c.id) : legalById.has(c.id) || d?.type === 'play'}
              onClick={() => clickCard(c.id)}
            />
          ))}
        </div>
      </section>

      {ctl.error && (
        <div className="toast" role="alert" onClick={ctl.clearError}>
          {ctl.error}
        </div>
      )}
      {v.result && <Result v={v} actions={resultActions} />}
    </div>
  )
}

function Centre({ v }: { v: GameView }) {
  const t = v.trans
  const name = (p: number) => v.players[p].name
  return (
    <div className="centre">
      {t ? (
        <div className={`envelope m-${t.method}`}>
          <span className="env-seal">{SEAL[t.method]}</span>
          <div className="env-body">
            <span className="env-title">
              {METHOD_NAME[t.method]}情報
              {t.method !== 'direct' && <span className="env-dir">{t.dir === 1 ? '順向' : '逆向'}傳遞</span>}
            </span>
            <span className="env-route">
              {name(t.sender)} 傳出
              {t.target != null && `，直達 ${name(t.target)}`}
            </span>
            <span className="env-where">
              {t.stage === 'A' ? `即將傳給 ${name(t.next)}` : `目前在 ${name(t.holder)} 面前`}
            </span>
          </div>
          <div className="env-card">{t.card ? <CardFace card={t.card} small /> : <span className="env-hidden">內容未知</span>}</div>
        </div>
      ) : (
        <div className="envelope is-idle">
          <span className="env-seal">候</span>
          <div className="env-body">
            <span className="env-title">等待 {name(v.active)} 傳出情報</span>
            <span className="env-route">出牌階段可先使用功能牌</span>
          </div>
        </div>
      )}
      {v.stack.length > 0 && (
        <ol className="stack" aria-label="結算中的卡牌（後發先至）">
          {v.stack.map((s) => (
            <li key={s.uid} className={s.countered ? 'is-countered' : ''}>
              <b>{name(s.user)}</b>
              {s.printed !== s.kind ? `【${KIND_NAME[s.printed]}】當作` : ''}【{KIND_NAME[s.kind]}】
              {s.uncounterable && <span className="muted">（不能識破）</span>}
              {s.target != null && s.kind !== 'counter' && <> → {name(s.target)}</>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function describeOthers(v: GameView, waitingOn: number[]): string {
  if (v.result) return '遊戲結束'
  const who = waitingOn.filter((p) => p !== v.me)
  if (who.length === 0) return '結算中…'
  const name = v.players[who[0]].name
  const t = v.trans
  if (v.phase === 'choose_character') return '等待其他玩家挑選角色…'
  if (t && t.stage === 'decide' && who[0] === t.holder) return `等待 ${name} 決定是否接收情報…`
  if (v.stack.length) return `等待 ${name} 決定要不要回應…`
  if (!t && who[0] === v.active) return `等待 ${name} 出牌…`
  if (t || v.stack.length) return `等待 ${name} 決定要不要用牌…`
  return `等待 ${name} 行動…`
}

function describe(v: GameView): string {
  const d = v.decision
  const name = (p: number) => v.players[p].name
  const t = v.trans
  if (!d) return ''
  switch (d.type) {
    case 'play':
      return '你的出牌階段：可以先使用功能牌，最後必須傳出一張情報。點選一張手牌。'
    case 'accept':
      return t?.card ? `要接收這份情報（${t.card.colour === 'black' ? '假情報' : `${COLOUR_NAME[t.card.colour]}色情報`}）嗎？` : '情報傳到你面前，要接收嗎？你不知道內容。'
    case 'ask':
      return d.ask.prompt
    case 'choose_character':
      return '挑選角色'
    case 'priority': {
      if (d.ctx === 'resp') {
        const top = v.stack[v.stack.length - 1]
        return `${name(top.user)} 使用了【${KIND_NAME[top.kind]}】${top.target != null && top.kind !== 'counter' ? `（目標 ${name(top.target)}）` : ''}。要用識破回應嗎？`
      }
      if (d.ctx === 'hopA') return `情報即將傳給 ${t ? name(t.next) : '—'}。要使用卡牌嗎？`
      if (d.ctx === 'hopB')
        return t?.holder === v.me ? '情報傳到你面前。可以先破譯或退回。' : `情報在 ${t ? name(t.holder) : '—'} 面前。要使用卡牌嗎？`
      return '要使用卡牌嗎？'
    }
  }
}

function Prompt({
  v,
  ctl,
  skip,
  selCard,
  legal,
  picked,
  setPicked,
  clear,
}: {
  v: GameView
  ctl: GameController
  skip: Skip
  selCard: Card | null
  legal: LegalPlay[]
  picked: number[]
  setPicked: (p: number[]) => void
  clear: () => void
}) {
  const d = v.decision
  const left = useSecondsLeft(d ? ctl.deadline : null)
  const act = (a: Action) => {
    ctl.act(a)
    clear()
  }
  const name = (p: number) => v.players[p].name
  const others = v.players.filter((p) => p.status === 'alive' && p.seat !== v.me)
  const mine = d && d.player === v.me

  return (
    <div className={`prompt ${mine ? 'is-mine' : ''}`}>
      <p className="prompt-text">
        {mine && <span className="your-turn">{d!.type === 'priority' ? '你可以回應' : d!.type === 'ask' ? d!.ask.title : '輪到你了'}</span>}
        {mine ? describe(v) : describeOthers(v, ctl.waitingOn)}
        {left != null && <span className={`countdown ${left <= 5 ? 'is-urgent' : ''}`}>剩 {left} 秒</span>}
      </p>

      {d?.type === 'ask' && <AskPanel v={v} ask={d.ask} picked={picked} setPicked={setPicked} act={act} />}

      {d?.type === 'accept' && (
        <div className="choices">
          <button type="button" className="primary" onClick={() => act({ type: 'accept' })}>
            接收情報
          </button>
          <button type="button" onClick={() => act({ type: 'decline' })}>
            不接收
          </button>
        </div>
      )}

      {(d?.type === 'play' || d?.type === 'priority') && selCard && (
        <div className="selected">
          <p className="sel-desc">
            <b>【{KIND_NAME[selCard.kind]}】</b>
            {KIND_DESC[selCard.kind]}
          </p>
          <div className="choices">
            {legal.map((l) => (
              <PlayOptions key={`${l.kind}-${l.as ? 1 : 0}`} legal={l} v={v} onPlay={act} />
            ))}
            {!legal.length && d.type === 'priority' && <span className="muted">這張牌現在不能使用。</span>}
            {d.type === 'play' &&
              (selCard.method === 'direct' ? (
                <span className="choice-group">
                  <span className="choice-label">直達傳給</span>
                  {others.map((p) => (
                    <button key={p.seat} type="button" className="primary" onClick={() => act({ type: 'send', card: selCard.id, target: p.seat })}>
                      {p.name}
                    </button>
                  ))}
                </span>
              ) : canSteer(v) ? (
                <span className="choice-group">
                  <span className="choice-label">以{METHOD_NAME[selCard.method]}傳出（貝雷帽可選方向）</span>
                  <button type="button" className="primary" onClick={() => act({ type: 'send', card: selCard.id, dir: 1 })}>
                    傳給 {name(nextSeat(v, 1))}
                  </button>
                  <button type="button" className="primary" onClick={() => act({ type: 'send', card: selCard.id, dir: -1 })}>
                    傳給 {name(nextSeat(v, -1))}
                  </button>
                </span>
              ) : (
                <button type="button" className="primary" onClick={() => act({ type: 'send', card: selCard.id })}>
                  以{METHOD_NAME[selCard.method]}傳出這張情報
                </button>
              ))}
          </div>
        </div>
      )}

      {(d?.type === 'play' || d?.type === 'priority') && v.skills.length > 0 && (
        <div className="choices skills">
          {v.skills.map((sk) => (
            <button key={sk.id} type="button" className="skill-btn" onClick={() => act({ type: 'use_skill', skill: sk.id })}>
              {sk.label}
            </button>
          ))}
        </div>
      )}

      {d?.type === 'priority' && (
        <div className="choices">
          <button type="button" onClick={() => act({ type: 'pass' })}>
            不使用
          </button>
          {skip.skipping ? (
            <button type="button" className="ghost" onClick={skip.stop}>
              恢復詢問
            </button>
          ) : (
            <button type="button" className="ghost" onClick={skip.skip} title="這個回合中與你無關的時機自動略過">
              本回合都略過
            </button>
          )}
        </div>
      )}

      {!mine && v.decision == null && !v.result && v.trans && (
        <p className="muted">{v.trans.stage === 'decide' ? `${name(v.trans.holder)} 正在決定是否接收…` : ''}</p>
      )}
    </div>
  )
}

function PlayOptions({ legal, v, onPlay }: { legal: LegalPlay; v: GameView; onPlay: (a: Action) => void }) {
  const name = (p: number) => v.players[p].name
  const card = v.hand.find((c) => c.id === legal.card)
  const label = legal.as && card ? `把【${KIND_NAME[card.kind]}】當作【${KIND_NAME[legal.kind]}】` : `使用【${KIND_NAME[legal.kind]}】`
  if (legal.kind === 'counter' && legal.refs) {
    const r = legal.refs[0]
    return (
      <button type="button" className="primary" onClick={() => onPlay({ type: 'play_card', card: legal.card, target: r.target, targetRef: r.ref })}>
        {label}識破 {name(r.target)}
      </button>
    )
  }
  if (legal.refs) {
    return (
      <span className="choice-group">
        <span className="choice-label">{label}</span>
        {legal.refs.map((r) => {
          const c = v.players[r.target].intel.find((x) => x.id === r.ref)
          return (
            <button key={r.ref} type="button" className="primary" onClick={() => onPlay({ type: 'play_card', card: legal.card, target: r.target, targetRef: r.ref })}>
              {name(r.target)} 的 {c && <IntelChip card={c} />}
            </button>
          )
        })}
      </span>
    )
  }
  if (legal.targets) {
    return (
      <span className="choice-group">
        <span className="choice-label">{label}，目標</span>
        {legal.targets.map((t) => (
          <button key={t} type="button" className="primary" onClick={() => onPlay({ type: 'play_card', card: legal.card, target: t, as: legal.as ? legal.kind : undefined })}>
            {t === v.me ? '自己' : name(t)}
          </button>
        ))}
      </span>
    )
  }
  return (
    <button type="button" className="primary" onClick={() => onPlay({ type: 'play_card', card: legal.card })}>
      {label}
    </button>
  )
}

function Log({ v }: { v: GameView }) {
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [v.log.length])
  return (
    <ol className="log" ref={ref} aria-label="遊戲紀錄" aria-live="polite">
      {v.log.map((l) => (
        <li
          key={l.seq}
          className={[l.vis ? 'is-private' : '', l.text.startsWith('──') ? 'is-turn' : '', l.text.startsWith('★') ? 'is-end' : '']
            .filter(Boolean)
            .join(' ')}
        >
          {l.vis && <span className="priv">僅你可見</span>}
          {l.text}
        </li>
      ))}
    </ol>
  )
}

function Result({ v, actions }: { v: GameView; actions: ReactNode }) {
  const r = v.result!
  const won = r.winners.includes(v.me)
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="遊戲結果">
      <div className="result">
        <h2>{r.winners.length === 0 ? '平手' : won ? '你贏了' : '你輸了'}</h2>
        <p>{r.reason}</p>
        <table>
          <tbody>
            {v.players.map((p) => (
              <tr key={p.seat} className={r.winners.includes(p.seat) ? 'is-win' : ''}>
                <td>{p.name}</td>
                <td>{p.faction ? FACTION_NAME[p.faction] : ''}</td>
                <td>{p.character ? CHAR_BY_ID[p.character].name : ''}</td>
                <td>{r.winners.includes(p.seat) ? '勝利' : p.status === 'alive' ? '' : p.status === 'dead' ? '死亡' : '出局'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="result-actions">{actions}</div>
      </div>
    </div>
  )
}

function canSteer(v: GameView) {
  const me = v.players[v.me]
  return me.character === 'beileimao' && me.charFaceUp
}

function nextSeat(v: GameView, dir: 1 | -1) {
  const n = v.players.length
  for (let k = 1; k <= n; k++) {
    const q = (((v.me + dir * k) % n) + n) % n
    if (v.players[q].status === 'alive') return q
  }
  return v.me
}

/** 技能與其他需要回答的問題 */
function AskPanel({
  v,
  ask,
  picked,
  setPicked,
  act,
}: {
  v: GameView
  ask: AskView
  picked: number[]
  setPicked: (p: number[]) => void
  act: (a: Action) => void
}) {
  const c = ask.choice
  const name = (p: number) => (p === v.me ? '自己' : v.players[p].name)
  const skipBtn = ask.canSkip && (
    <button type="button" onClick={() => act({ type: 'skip' })}>
      {c.kind === 'confirm' ? '不要' : '略過'}
    </button>
  )
  if (c.kind === 'confirm')
    return (
      <div className="choices">
        <button type="button" className="primary" onClick={() => act({ type: 'answer', value: true })}>
          發動
        </button>
        {skipBtn}
      </div>
    )
  if (c.kind === 'options')
    return (
      <div className="choices">
        {c.options.map((o) => (
          <button key={o.id} type="button" className="primary" onClick={() => act({ type: 'answer', value: o.id })}>
            {o.label}
          </button>
        ))}
        {skipBtn}
      </div>
    )
  if (c.kind === 'player')
    return (
      <div className="choices">
        {c.seats.map((q) => (
          <button key={q} type="button" className="primary" onClick={() => act({ type: 'answer', value: q })}>
            {name(q)}
          </button>
        ))}
        {skipBtn}
      </div>
    )
  if (c.zone === 'slots')
    return (
      <div className="choices">
        {c.ids.map((i) => (
          <button key={i} type="button" className="facedown" onClick={() => act({ type: 'answer', value: [i] })}>
            第 {i + 1} 張
          </button>
        ))}
      </div>
    )
  const toggle = (id: number) =>
    setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : c.max === 1 ? [id] : picked.length < c.max ? [...picked, id] : picked)
  const ok = picked.length >= c.min && picked.length <= c.max
  const need = c.min === c.max ? `${c.min} 張` : `${c.min}–${c.max} 張`
  return (
    <div className="choices">
      {c.zone === 'intel' && c.owner != null && (
        <span className="choice-group">
          {v.players[c.owner].intel
            .filter((x) => c.ids.includes(x.id))
            .map((x) => (
              <button key={x.id} type="button" className={`intel-pick ${picked.includes(x.id) ? 'on' : ''}`} aria-pressed={picked.includes(x.id)} onClick={() => toggle(x.id)}>
                <IntelChip card={x} /> {KIND_NAME[x.kind]}
              </button>
            ))}
        </span>
      )}
      {c.zone === 'hand' && <span className="choice-label">點選下方手牌（{need}）</span>}
      <button type="button" className="primary" disabled={!ok} onClick={() => act({ type: 'answer', value: picked })}>
        確定（已選 {picked.length} 張）
      </button>
      {skipBtn}
    </div>
  )
}
