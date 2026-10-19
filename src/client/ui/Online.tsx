import { useEffect, useState } from 'react'
import { FACTION_SETUPS } from '../../engine/data'
import type { RoomSession } from '../net/session'
import { VoiceMesh } from '../net/voice'
import { useStore, type GameController, type Social } from './controller'
import { DocsButtons } from './Docs'
import { GameScreen } from './Game'
import { ChatPanel, VoiceControls } from './social'

export function inviteLink(code: string) {
  const u = new URL(location.origin + location.pathname)
  u.searchParams.set('room', code)
  return u.toString()
}

/** 連線遊戲：房間畫面與牌桌都由伺服器的資料驅動 */
export function OnlineScreen({ session, onExit }: { session: RoomSession; onExit: () => void }) {
  useStore(session)
  const [voice, setVoice] = useState<VoiceMesh | null>(null)
  useEffect(() => {
    const v = new VoiceMesh(session)
    setVoice(v)
    return () => v.dispose()
  }, [session])
  const room = session.room
  const roster = (room?.members ?? []).filter((m) => m.inVoice && m.connected).map((m) => m.clientId)
  const rosterKey = roster.join(',')
  useEffect(() => {
    voice?.sync(roster)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, rosterKey])

  const leave = () => {
    session.leave()
    onExit()
  }

  if (session.status === 'closed') return <Centered text={session.error ?? '連線已結束'} action={onExit} actionLabel="回到大廳" />
  if (!room) return <Centered text={`正在連線到房間 ${session.code}…`} action={leave} actionLabel="取消" />

  const banner = session.status === 'reconnecting' && <div className="banner">連線中斷，正在重新連線…</div>
  const social: Social = { me: session.me, room, chat: session.chat, say: session.say, voice }
  const g = session.game
  if (g && room.started) {
    const ctl: GameController = {
      view: g.view,
      act: session.act,
      error: session.lastError,
      clearError: session.clearError,
      waitingOn: g.waitingOn,
      deadline: g.deadline,
      aiControlled: g.aiControlled,
    }
    return (
      <>
        {banner}
        <GameScreen
          ctl={ctl}
          social={social}
          onExit={leave}
          exitLabel="離開房間"
          historyId={`online-${g.gameId}`}
          topExtra={<span className="room-code">房號 {room.code}</span>}
          resultActions={
            session.isOwner ? (
              <>
                <button type="button" className="primary" onClick={session.backToRoom}>
                  回到房間再來一局
                </button>
                <button type="button" onClick={leave}>
                  離開房間
                </button>
              </>
            ) : (
              <>
                <span className="muted">等房主開新的一局…</span>
                <button type="button" onClick={leave}>
                  離開房間
                </button>
              </>
            )
          }
        />
      </>
    )
  }
  return (
    <>
      {banner}
      <RoomView session={session} voice={voice} onLeave={leave} />
    </>
  )
}

function RoomView({ session, voice, onLeave }: { session: RoomSession; voice: VoiceMesh | null; onLeave: () => void }) {
  const room = session.room!
  const isOwner = session.isOwner
  const [copied, setCopied] = useState(false)
  const s = room.settings
  const setups = FACTION_SETUPS[s.count]
  const setup = setups[Math.min(s.setupIdx, setups.length - 1)]
  const humans = room.members.length
  const ai = Math.max(0, s.count - humans)
  const owner = room.members.find((m) => m.clientId === room.ownerId)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(room.code))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      prompt('複製這個連結傳給朋友：', inviteLink(room.code))
    }
  }

  return (
    <div className="room">
      <header className="topbar">
        <span className="brand">風聲</span>
        <span className="turn">房間</span>
        <VoiceControls voice={voice} speakers={room.members.filter((m) => m.inVoice).length} />
        <DocsButtons />
        <button type="button" className="ghost" onClick={onLeave}>
          離開房間
        </button>
      </header>

      <div className="room-body">
        <section className="room-main">
          <div className="invite">
            <span className="invite-label">邀請碼</span>
            <span className="invite-code" aria-label={`邀請碼 ${room.code.split('').join(' ')}`}>
              {room.code}
            </span>
            <button type="button" className="primary" onClick={() => void copy()}>
              {copied ? '已複製連結' : '複製邀請連結'}
            </button>
            <p className="muted">朋友打開連結、輸入名字就能加入，任何網路都可以。</p>
          </div>

          <h2>
            玩家（{humans} / {s.count}）
          </h2>
          <ul className="members">
            {room.members.map((m) => (
              <li key={m.clientId} className={m.connected ? '' : 'is-off'}>
                <span className="m-name">
                  {m.name}
                  {m.clientId === session.me && <span className="seat-you">你</span>}
                </span>
                {m.clientId === room.ownerId && <span className="tag">房主</span>}
                {m.inVoice && <span className="tag tag-voice">語音中</span>}
                {!m.connected && <span className="tag">斷線</span>}
              </li>
            ))}
            {Array.from({ length: ai }, (_, i) => (
              <li key={`ai${i}`} className="is-ai">
                <span className="m-name">電腦補位</span>
              </li>
            ))}
          </ul>

          <h2>設定</h2>
          {isOwner ? (
            <div className="room-settings">
              <div className="field">
                <span>遊戲人數（人不夠會由電腦補位）</span>
                <div className="segmented" role="radiogroup" aria-label="遊戲人數">
                  {[3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={n === s.count}
                      className={n === s.count ? 'on' : ''}
                      disabled={n < humans}
                      onClick={() => session.updateSettings({ count: n, setupIdx: 0 })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>陣營配置</span>
                <div className="setups">
                  {setups.map((x, i) => (
                    <button key={i} type="button" className={`setup ${x === setup ? 'on' : ''}`} aria-pressed={x === setup} onClick={() => session.updateSettings({ setupIdx: i })}>
                      <b className="f-red">潛伏 {x[0]}</b>
                      <b className="f-blue">軍情 {x[1]}</b>
                      <b className="f-neutral">特工 {x[2]}</b>
                    </button>
                  ))}
                </div>
              </div>
              <label className={`check ${setup[2] < 2 ? 'is-disabled' : ''}`}>
                <input type="checkbox" checked={s.alliance} disabled={setup[2] < 2} onChange={(e) => session.updateSettings({ alliance: e.target.checked })} />
                <span>
                  特工同盟
                  <small>一位特工宣告勝利時，所有特工一同勝利。</small>
                </span>
              </label>
              <button type="button" className="primary start" onClick={session.start}>
                開始遊戲{ai > 0 ? `（${ai} 位電腦補位）` : ''}
              </button>
            </div>
          ) : (
            <p className="room-readonly">
              {s.count} 人局．潛伏 {setup[0]}、軍情 {setup[1]}、特工 {setup[2]}
              {s.alliance ? '．特工同盟' : ''}
              <br />
              <span className="muted">等房主{owner ? `（${owner.name}）` : ''}開始遊戲…</span>
            </p>
          )}
        </section>

        <aside className="room-chat">
          <h2>聊天</h2>
          <ChatPanel chat={session.chat} me={session.me} say={session.say} />
        </aside>
      </div>
    </div>
  )
}

export function Centered({ text, action, actionLabel }: { text: string; action?: () => void; actionLabel?: string }) {
  return (
    <main className="centered">
      <p>{text}</p>
      {action && (
        <button type="button" onClick={action}>
          {actionLabel}
        </button>
      )}
    </main>
  )
}
