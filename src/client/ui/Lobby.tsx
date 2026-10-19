import { useState } from 'react'
import { FACTION_NAME, FACTION_SETUPS } from '../../engine/data'
import type { GameConfig } from '../../engine/types'
import { DocsButtons } from './Docs'
import { normaliseCode } from '../../shared/protocol'
import { clearHistory, loadHistory } from './history'

const AI_NAMES = ['顧曉夢', '李寧玉', '吳志國', '白小年', '金生火', '王田香', '老周', '小方']

function storedName() {
  try {
    return localStorage.getItem('fs-name') ?? ''
  } catch {
    return ''
  }
}

export function Lobby({
  onLocal,
  onOnline,
}: {
  onLocal: (cfg: GameConfig) => void
  onOnline: (code: string, name: string, create: boolean) => void
}) {
  const urlRoom = normaliseCode(new URLSearchParams(location.search).get('room') ?? '')
  const [name, setName] = useState(storedName)
  const [code, setCode] = useState(urlRoom)
  const [count, setCount] = useState(5)
  const [setupIdx, setSetupIdx] = useState(0)
  const [alliance, setAlliance] = useState(false)
  const [nameErr, setNameErr] = useState(false)
  const [busy, setBusy] = useState(false)
  const [netErr, setNetErr] = useState<string | null>(null)
  const [history, setHistory] = useState(loadHistory)
  const setups = FACTION_SETUPS[count]
  const setup = setups[Math.min(setupIdx, setups.length - 1)]

  const myName = () => {
    const n = name.trim()
    try {
      if (n) localStorage.setItem('fs-name', n)
    } catch {
      /* ignore */
    }
    return n
  }

  const needName = () => {
    const n = myName()
    if (!n) setNameErr(true)
    return n
  }

  const startLocal = () => {
    const me = myName() || '我'
    const names = [...AI_NAMES].sort(() => Math.random() - 0.5)
    onLocal({
      players: [
        { id: 'me', name: me, isAI: false },
        ...Array.from({ length: count - 1 }, (_, i) => ({ id: `ai${i}`, name: names[i], isAI: true })),
      ],
      factions: setup,
      neutralAlliance: alliance && setup[2] >= 2,
      seed: (Math.random() * 2 ** 31) | 0,
    })
  }

  return (
    <main className="lobby">
      <header className="lobby-title">
        <h1>風聲</h1>
        <p>諜戰推理卡牌遊戲．第二版</p>
        <DocsButtons />
      </header>

      <label className={`field name-field ${nameErr ? 'has-error' : ''}`}>
        <span>你的名字</span>
        <input
          value={name}
          maxLength={12}
          placeholder="輸入暱稱"
          autoFocus={!!urlRoom}
          onChange={(e) => {
            setName(e.target.value)
            setNameErr(false)
          }}
        />
        {nameErr && <small className="err">連線遊戲需要先輸入名字。</small>}
      </label>

      {urlRoom && (
        <section className="lobby-panel is-invite" aria-label="受邀加入房間">
          <h2>你被邀請加入房間 {urlRoom}</h2>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const n = needName()
              if (n) onOnline(urlRoom, n, false)
            }}
          >
            加入房間
          </button>
        </section>
      )}

      <section className="lobby-panel" aria-label="和朋友連線">
        <h2>和朋友連線</h2>
        <div className="online-row">
          <div>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                const n = needName()
                if (!n) return
                setBusy(true)
                setNetErr(null)
                fetch('/api/new')
                  .then((r) => r.json() as Promise<{ code: string }>)
                  .then(({ code }) => onOnline(code, n, true))
                  .catch(() => setNetErr('連不到遊戲伺服器，請檢查網路後再試。'))
                  .finally(() => setBusy(false))
              }}
            >
              建立房間
            </button>
            <p className="muted">遊戲在雲端伺服器進行，任何網路都能連。</p>
          </div>
          <form
            className="join"
            onSubmit={(e) => {
              e.preventDefault()
              const n = needName()
              const c = normaliseCode(code)
              if (n && c) onOnline(c, n, false)
            }}
          >
            <input value={code} onChange={(e) => setCode(normaliseCode(e.target.value))} placeholder="邀請碼" aria-label="邀請碼" maxLength={8} />
            <button type="submit" disabled={!normaliseCode(code)}>
              加入
            </button>
          </form>
        </div>
        {netErr && <p className="err">{netErr}</p>}
      </section>

      <section className="lobby-panel" aria-label="單機對戰 AI">
        <h2>單機對戰 AI</h2>
        <div className="field">
          <span>遊戲人數（含你）</span>
          <div className="segmented" role="radiogroup" aria-label="遊戲人數">
            {[3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === count}
                className={n === count ? 'on' : ''}
                onClick={() => {
                  setCount(n)
                  setSetupIdx(0)
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>陣營配置</span>
          <div className="setups">
            {setups.map((s, i) => (
              <button key={i} type="button" className={`setup ${s === setup ? 'on' : ''}`} aria-pressed={s === setup} onClick={() => setSetupIdx(i)}>
                <b className="f-red">潛伏 {s[0]}</b>
                <b className="f-blue">軍情 {s[1]}</b>
                <b className="f-neutral">特工 {s[2]}</b>
              </button>
            ))}
          </div>
        </div>

        <label className={`check ${setup[2] < 2 ? 'is-disabled' : ''}`}>
          <input type="checkbox" checked={alliance && setup[2] >= 2} disabled={setup[2] < 2} onChange={(e) => setAlliance(e.target.checked)} />
          <span>
            特工同盟
            <small>一位特工宣告勝利時，所有特工一同勝利。需要至少兩位特工。</small>
          </span>
        </label>

        <button type="button" className="primary" onClick={startLocal}>
          開始單機遊戲
        </button>
      </section>

      {history.length > 0 && (
        <section className="lobby-panel" aria-label="最近對局">
          <h2>最近對局</h2>
          <ul className="history">
            {history.slice(0, 8).map((h) => (
              <li key={h.id}>
                <span className={`h-result ${h.won ? 'is-win' : ''}`}>{h.won ? '勝' : '敗'}</span>
                <span className="h-meta">
                  {new Date(h.at).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}．{h.mode === 'online' ? '連線' : '單機'}．
                  {h.players.length} 人．你是{h.myFaction ? FACTION_NAME[h.myFaction] : '—'}
                </span>
                <span className="h-reason">{h.reason}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              clearHistory()
              setHistory([])
            }}
          >
            清除紀錄
          </button>
        </section>
      )}

      <footer className="lobby-foot">第二版：3D 牌桌、雲端連線。108 張規則與 18 個角色技能皆已實裝。</footer>
    </main>
  )
}
