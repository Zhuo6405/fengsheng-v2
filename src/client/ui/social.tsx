import { useEffect, useRef, useState } from 'react'
import type { ChatMsg } from '../../shared/protocol'
import type { VoiceMesh } from '../net/voice'
import { useStore } from './controller'

export function ChatPanel({ chat, me, say }: { chat: ChatMsg[]; me: string; say: (t: string) => void }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat.length])
  const send = () => {
    const t = text.trim()
    if (!t) return
    say(t)
    setText('')
  }
  return (
    <div className="chat">
      <ol className="chat-list" ref={ref} aria-label="聊天" aria-live="polite">
        {chat.length === 0 && <li className="chat-empty">還沒有人說話。打聲招呼吧。</li>}
        {chat.map((m) => (
          <li key={m.id} className={m.system ? 'is-system' : m.clientId === me ? 'is-me' : ''}>
            {!m.system && <b>{m.name}</b>}
            <span>{m.text}</span>
          </li>
        ))}
      </ol>
      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="輸入訊息，Enter 送出" aria-label="聊天訊息" />
        <button type="submit" disabled={!text.trim()}>
          送出
        </button>
      </form>
    </div>
  )
}

export function VoiceControls({ voice, speakers }: { voice: VoiceMesh | null; speakers: number }) {
  useStore(voice ?? NOOP)
  if (!voice) return null
  if (!voice.on) {
    return (
      <span className="voice">
        <button type="button" onClick={() => void voice.enable()} title="開啟麥克風加入語音">
          加入語音{speakers > 0 ? `（${speakers} 人在線）` : ''}
        </button>
        {voice.error && <span className="voice-err">{voice.error}</span>}
      </span>
    )
  }
  return (
    <span className="voice is-on">
      <span className="voice-dot" aria-hidden />
      <span className="voice-n">語音 {voice.connectedCount + 1} 人</span>
      <button type="button" onClick={() => voice.setMuted(!voice.muted)} aria-pressed={voice.muted}>
        {voice.muted ? '取消靜音' : '靜音'}
      </button>
      <button type="button" className="ghost" onClick={() => voice.disable()}>
        離開語音
      </button>
    </span>
  )
}

const NOOP = { subscribe: () => () => {}, version: 0 }
