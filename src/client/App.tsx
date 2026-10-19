import { useState } from 'react'
import type { GameConfig } from '../engine/types'
import { RoomSession } from './net/session'
import { LocalGame } from './ui/Game'
import { Lobby } from './ui/Lobby'
import { OnlineScreen } from './ui/Online'

type Mode = { k: 'lobby' } | { k: 'local'; config: GameConfig } | { k: 'online'; session: RoomSession }

function clearRoomParam() {
  const u = new URL(location.href)
  if (u.searchParams.has('room')) {
    u.searchParams.delete('room')
    history.replaceState(null, '', u.toString())
  }
}

export default function App() {
  const [mode, setMode] = useState<Mode>({ k: 'lobby' })
  const back = () => {
    clearRoomParam()
    setMode({ k: 'lobby' })
  }
  switch (mode.k) {
    case 'local':
      return <LocalGame key={mode.config.seed} config={mode.config} onExit={back} />
    case 'online':
      return <OnlineScreen key={mode.session.code} session={mode.session} onExit={back} />
    default:
      return (
        <Lobby
          onLocal={(config) => setMode({ k: 'local', config })}
          onOnline={(code, name, create) => {
            const s = new RoomSession(code, name, create)
            s.connect()
            const u = new URL(location.href)
            u.searchParams.set('room', code)
            history.replaceState(null, '', u.toString())
            setMode({ k: 'online', session: s })
          }}
        />
      )
  }
}
