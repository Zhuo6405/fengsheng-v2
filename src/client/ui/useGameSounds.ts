import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { GameView } from '../../engine/view'
import type { ChatMsg } from '../../shared/protocol'
import { onSoundChange, play, setSoundOn, soundOn } from '../sound'

/** 比對前後兩個畫面，發出對應的音效 */
export function useGameSounds(v: GameView, chat: ChatMsg[] | undefined, myClientId: string | undefined) {
  const prev = useRef<GameView | null>(null)
  useEffect(() => {
    const p = prev.current
    prev.current = v
    if (!p || p.phase === 'choose_character') return

    if (v.result && !p.result) {
      play(v.result.winners.includes(v.me) ? 'win' : 'lose')
      return
    }
    if (v.deaths.length > p.deaths.length) play('death')

    // 情報到手：依顏色蓋章
    for (const pl of v.players) {
      const before = p.players[pl.seat]?.intel.length ?? 0
      if (pl.intel.length > before) {
        const c = pl.intel[pl.intel.length - 1]
        play(c.colour === 'red' ? 'stampRed' : c.colour === 'blue' ? 'stampBlue' : 'stampBlack')
        break
      }
    }

    // 新打出的功能牌
    const oldUids = new Set(p.stack.map((x) => x.uid))
    const fresh = v.stack.filter((x) => !oldUids.has(x.uid))
    if (fresh.length) play(fresh.some((x) => x.kind === 'counter') ? 'counter' : 'card')

    // 情報傳出 / 傳到下一位
    if (v.trans && (!p.trans || p.turnNo !== v.turnNo)) play('send')
    else if (v.trans && p.trans && v.trans.holder !== p.trans.holder) play('hop')

    // 換回合／輪到你
    const d = v.decision
    const pd = p.decision
    if (v.turnNo !== p.turnNo || v.active !== p.active) {
      if (v.active === v.me) play('myTurn')
      else play('turn')
    } else if (d && d.type !== 'priority' && d.type !== 'play' && (!pd || pd.type !== d.type)) {
      play('prompt')
    }
  }, [v])

  // 別人傳來的聊天訊息
  const chatLen = chat?.length ?? 0
  const seen = useRef(chatLen)
  useEffect(() => {
    if (chat && chatLen > seen.current) {
      const last = chat[chatLen - 1]
      if (!last.system && last.clientId !== myClientId) play('chat')
    }
    seen.current = chatLen
  }, [chat, chatLen, myClientId])
}

export function useSoundOn(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(onSoundChange, soundOn, soundOn)
  return [on, setSoundOn]
}
