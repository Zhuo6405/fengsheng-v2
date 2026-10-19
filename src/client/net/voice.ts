import type { RoomSession } from './session'

type Signal = { sdp?: RTCSessionDescriptionInit; ice?: RTCIceCandidateInit }

/**
 * 語音：開麥克風的人彼此直接連線（mesh）。連線資訊（信令）經由遊戲伺服器轉送，
 * 伺服器有設定 TURN 時，被擋 P2P 的網路也能透過中繼通話。
 * 為了避免兩邊同時撥號，由 id 比較小的一方發起。
 */
export class VoiceMesh {
  stream: MediaStream | null = null
  muted = false
  error: string | null = null
  version = 0
  private pcs = new Map<string, RTCPeerConnection>()
  private audios = new Map<string, HTMLAudioElement>()
  private subs = new Set<() => void>()
  private roster: string[] = []
  private ice: RTCIceServer[] | null = null
  private off: () => void
  private session: RoomSession

  constructor(session: RoomSession) {
    this.session = session
    this.off = session.onRtc((from, data) => void this.onSignal(from, data as Signal))
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn)
    return () => {
      this.subs.delete(fn)
    }
  }

  private emit() {
    this.version++
    for (const fn of this.subs) fn()
  }

  get on() {
    return !!this.stream
  }

  get connectedCount() {
    return this.audios.size
  }

  private async iceServers(): Promise<RTCIceServer[]> {
    if (this.ice) return this.ice
    try {
      const r = await fetch('/api/ice')
      const j = (await r.json()) as { iceServers: RTCIceServer[] }
      this.ice = j.iceServers
    } catch {
      this.ice = [{ urls: 'stun:stun.l.google.com:19302' }]
    }
    return this.ice
  }

  async enable() {
    if (this.stream) return
    try {
      await this.iceServers()
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      this.error = null
      this.muted = false
      this.session.setVoice(true)
      this.sync(this.roster)
    } catch (e) {
      const name = (e as { name?: string }).name
      this.error = name === 'NotAllowedError' ? '沒有取得麥克風權限，請在瀏覽器網址列允許使用麥克風。' : '找不到可用的麥克風。'
    }
    this.emit()
  }

  disable() {
    for (const id of [...this.pcs.keys()]) this.drop(id)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.session.setVoice(false)
    this.emit()
  }

  setMuted(m: boolean) {
    this.muted = m
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !m))
    this.emit()
  }

  /** 房間的語音名單（clientId）更新時呼叫 */
  sync(roster: string[]) {
    this.roster = roster
    if (!this.stream) return
    const me = this.session.me
    const others = roster.filter((id) => id !== me)
    for (const id of [...this.pcs.keys()]) if (!others.includes(id)) this.drop(id)
    for (const id of others) if (!this.pcs.has(id) && me < id) void this.call(id)
  }

  private makePc(id: string) {
    const pc = new RTCPeerConnection({ iceServers: this.ice ?? [] })
    this.pcs.set(id, pc)
    this.stream?.getTracks().forEach((t) => pc.addTrack(t, this.stream!))
    pc.onicecandidate = (e) => {
      if (e.candidate) this.session.rtc(id, { ice: e.candidate.toJSON() })
    }
    pc.ontrack = (e) => {
      let a = this.audios.get(id)
      if (!a) {
        a = document.createElement('audio')
        a.autoplay = true
        a.dataset.voicePeer = id
        a.style.display = 'none'
        document.body.appendChild(a)
        this.audios.set(id, a)
      }
      a.srcObject = e.streams[0]
      void a.play().catch(() => {})
      this.emit()
    }
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(id)
    }
    return pc
  }

  private async call(id: string) {
    const pc = this.makePc(id)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    this.session.rtc(id, { sdp: pc.localDescription!.toJSON() })
  }

  private async onSignal(from: string, s: Signal) {
    if (!this.stream) return
    try {
      let pc = this.pcs.get(from)
      if (s.sdp) {
        if (s.sdp.type === 'offer') {
          if (pc) this.drop(from)
          pc = this.makePc(from)
          await pc.setRemoteDescription(s.sdp)
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          this.session.rtc(from, { sdp: pc.localDescription!.toJSON() })
        } else if (pc) {
          await pc.setRemoteDescription(s.sdp)
        }
      } else if (s.ice && pc) {
        await pc.addIceCandidate(s.ice)
      }
    } catch (e) {
      console.warn('voice signal', e)
    }
  }

  private drop(id: string) {
    this.pcs.get(id)?.close()
    this.pcs.delete(id)
    this.audios.get(id)?.remove()
    this.audios.delete(id)
    this.emit()
  }

  dispose() {
    this.off()
    this.disable()
    this.subs.clear()
  }
}
