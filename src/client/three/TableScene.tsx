import type React from 'react'
import { Html, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'
import { clampedPosition, keepVisible } from './plateClamp'
import { CHAR_BY_ID, FACTION_NAME } from '../../engine/data'
import type { Card, Method } from '../../engine/types'
import type { GameView, PublicPlayer } from '../../engine/view'
import { IntelSummary } from '../ui/IntelSummary'
import { cardBackTexture, cardTexture, clearTextures, dossierTexture } from './textures'

// 3D 牌桌：圍坐的特工、桌上的情報、在座位間移動的卷宗

const TABLE_R = 3.4
const SEAT_R = 4.35
const TABLE_Y = 0.92
const COATS = ['#3b3f45', '#7a5c3e', '#2f3b52', '#4d5233', '#5a2e2e', '#55504a', '#2e4a48', '#6b4f2a', '#3d3550']

function seatAngle(seat: number, me: number, n: number) {
  return (((seat - me + n) % n) / n) * Math.PI * 2
}
const polar = (theta: number, r: number, y: number) => new THREE.Vector3(r * Math.sin(theta), y, r * Math.cos(theta))

export type ViewMode = 'first' | 'overview'

/** 名牌固定放進這個容器：避免 drei 在事件連線後換容器、把名牌內容弄丟 */
const PlateHost = createContext<RefObject<HTMLDivElement | null> | null>(null)

export interface SceneProps {
  v: GameView
  waitingOn: number[]
  aiControlled: number[]
  mode: ViewMode
  /** 第一人稱時，手上被選取的牌（會抬高） */
  selected?: number | null
}

/**
 * 手機瀏覽器在記憶體吃緊時會收回 WebGL：只在「目前畫面上這張畫布」真的被收回時重建一次。
 * 牌桌重建（例如字型載入完）時，舊畫布會被刻意釋放，那不算，否則會一直重建造成閃爍。
 */
let liveCanvas: HTMLCanvasElement | null = null
let rebuilds: number[] = []
function watchContext(canvas: HTMLCanvasElement, rebuild: () => void) {
  liveCanvas = canvas
  const isLive = () => canvas === liveCanvas && canvas.isConnected
  const go = () => {
    if (!isLive()) return
    // 保險：一分鐘內最多重建 3 次
    const now = Date.now()
    rebuilds = rebuilds.filter((x) => now - x < 60_000)
    if (rebuilds.length >= 3) return
    rebuilds.push(now)
    liveCanvas = null
    document.removeEventListener('visibilitychange', onVisible)
    setTimeout(rebuild, 300)
  }
  canvas.addEventListener('webglcontextlost', (e) => {
    if (!isLive()) return
    e.preventDefault()
    go()
  })
  function onVisible() {
    if (!isLive()) return document.removeEventListener('visibilitychange', onVisible)
    if (document.visibilityState !== 'visible') return
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null
    if (gl?.isContextLost()) go()
  }
  document.addEventListener('visibilitychange', onVisible)
}

export function TableScene({ v, waitingOn, aiControlled, mode, selected }: SceneProps) {
  const [fontsReady, setFontsReady] = useState(0)
  // 手機瀏覽器在記憶體吃緊時會收回 WebGL，收回後重新建立牌桌，不會留下一片空白
  const [revive, setRevive] = useState(0)
  useEffect(() => {
    void document.fonts?.ready.then(() => {
      clearTextures()
      setFontsReady((x) => x + 1)
    })
  }, [])
  const reduced = useMemo(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false, [])
  const host = useRef<HTMLDivElement>(null)
  return (
    <div ref={host} className="scene-host">
      <PlateHost.Provider value={host}>
        <Canvas shadows dpr={[1, 2]} camera={{ position: [0, 6.4, 8.2], fov: 44 }} gl={{ antialias: true }} key={`${fontsReady}-${revive}`} onCreated={({ gl }) => watchContext(gl.domElement, () => setRevive((x) => x + 1))}>
          <color attach="background" args={['#1b130e']} />
          <fog attach="fog" args={['#1b130e', 18, 34]} />
          <ambientLight intensity={0.75} color="#ffe8c8" />
          <hemisphereLight args={['#ffe2b8', '#2a1a10', 0.9]} />
          <directionalLight position={[0, 6, 9]} intensity={0.9} color="#ffe6c4" />
          {mode === 'overview' ? <CameraRig /> : <FirstPersonRig />}
          <Lamp />
          <Floor />
          <Table />
          <Piles deck={v.deckCount} discard={v.discardCount} />
          {v.players.map((p) => (
            <Seat
              key={p.seat}
              p={p}
              v={v}
              theta={seatAngle(p.seat, v.me, v.players.length)}
              acting={waitingOn.includes(p.seat)}
              aiControlled={aiControlled.includes(p.seat)}
              reduced={reduced}
              mode={mode}
            />
          ))}
          {mode === 'first' && <MyHand v={v} selected={selected ?? null} />}
          <Dossier v={v} reduced={reduced} />
          {mode === 'overview' && (
          <OrbitControls
            target={[0, TABLE_Y, 0.2]}
            enablePan={false}
            minDistance={7}
            maxDistance={22}
            minPolarAngle={0.35}
            maxPolarAngle={1.2}
            minAzimuthAngle={-0.9}
            maxAzimuthAngle={0.9}
            enableDamping
          />
          )}
        </Canvas>
      </PlateHost.Provider>
    </div>
  )
}

// ───────── 場景 ─────────

/** 直式螢幕（手機）時把鏡頭拉遠，整張桌子才看得到 */
function CameraRig() {
  const { camera, size } = useThree()
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height)
    const k = aspect >= 1.2 ? 1 : 1 + (1.2 - aspect) * 1.25
    camera.position.set(0, 6.4 * k, 8.2 * k)
    camera.lookAt(0, TABLE_Y, 0.2)
  }, [camera, size.width, size.height])
  return null
}

const EYE = new THREE.Vector3(0, 2.35, SEAT_R + 0.3)

/** 第一人稱：坐在自己的位子上，拖曳可以轉頭看其他人 */
function FirstPersonRig() {
  const { camera, size, gl } = useThree()
  const look = useRef({ yaw: 0, pitch: -0.36 })
  useEffect(() => {
    const cam = camera as THREE.PerspectiveCamera
    const portrait = size.width < size.height
    cam.fov = portrait ? 86 : 70
    cam.updateProjectionMatrix()
    cam.position.copy(EYE)
    if (portrait) cam.position.z += 0.6
    return () => {
      cam.fov = 44
      cam.updateProjectionMatrix()
    }
  }, [camera, size.width, size.height])
  useEffect(() => {
    const el = gl.domElement
    let drag: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY }
      el.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!drag) return
      const L = look.current
      L.yaw = Math.max(-1.15, Math.min(1.15, L.yaw - (e.clientX - drag.x) * 0.004))
      L.pitch = Math.max(-0.9, Math.min(0.15, L.pitch - (e.clientY - drag.y) * 0.004))
      drag = { x: e.clientX, y: e.clientY }
    }
    const up = () => (drag = null)
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [gl])
  useFrame(() => {
    const { yaw, pitch } = look.current
    const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    camera.lookAt(camera.position.clone().add(dir))
  })
  return null
}

/** 第一人稱時，自己雙手拿著的手牌（看得到牌面） */
function MyHand({ v, selected }: { v: GameView; selected: number | null }) {
  const cards = v.hand.slice(0, 14)
  const n = cards.length
  const spread = Math.min(0.3 * Math.max(0, n - 1), 1.9)
  const coat = COATS[v.me % COATS.length]
  if (v.players[v.me]?.status !== 'alive') return null
  return (
    <group position={[0, 1.78, SEAT_R - 0.42]} rotation-x={-0.6}>
      {cards.map((c, i) => {
        const a = n > 1 ? -spread / 2 + (spread * i) / (n - 1) : 0
        const up = c.id === selected ? 0.05 : 0
        return (
          <group key={c.id} rotation-z={-a} position={[0, 0, i * 0.004]}>
            <mesh position={[0, 0.15 + up, 0]}>
              <planeGeometry args={[0.13, 0.185]} />
              <meshStandardMaterial map={cardTexture(c)} side={THREE.DoubleSide} roughness={0.8} />
            </mesh>
          </group>
        )
      })}
      {/* 雙手 */}
      {[-1, 1].map((sx) => (
        <group key={sx}>
          <mesh position={[sx * 0.075, 0.0, 0.04]}>
            <sphereGeometry args={[0.042, 14, 12]} />
            <meshStandardMaterial color="#d8b18e" />
          </mesh>
          <mesh position={[sx * 0.14, -0.08, 0.22]} rotation={[1.15, 0, sx * 0.4]}>
            <capsuleGeometry args={[0.045, 0.3, 6, 12]} />
            <meshStandardMaterial color={coat} roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function Lamp() {
  return (
    <group position={[0, 5.4, 0]}>
      <mesh position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.015, 0.015, 3.2]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      <mesh castShadow>
        <coneGeometry args={[0.9, 0.55, 40, 1, true]} />
        <meshStandardMaterial color="#2f4a3a" metalness={0.4} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, -0.12, 0]}>
        <sphereGeometry args={[0.16, 24, 16]} />
        <meshStandardMaterial color="#fff2cc" emissive="#ffd890" emissiveIntensity={3} />
      </mesh>
      <spotLight
        position={[0, -0.1, 0]}
        target-position={[0, -5.4, 0]}
        angle={0.95}
        penumbra={0.7}
        intensity={140}
        decay={1.6}
        color="#ffd9a0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      <pointLight position={[0, -0.4, 0]} intensity={18} distance={16} decay={1.2} color="#ffcf8a" />
    </group>
  )
}

function Floor() {
  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <circleGeometry args={[16, 64]} />
      <meshStandardMaterial color="#2a1d15" roughness={0.9} />
    </mesh>
  )
}

function Table() {
  return (
    <group>
      <mesh position={[0, TABLE_Y - 0.08, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TABLE_R, TABLE_R, 0.16, 72]} />
        <meshStandardMaterial color="#3d2416" roughness={0.45} metalness={0.05} />
      </mesh>
      <mesh position={[0, TABLE_Y + 0.002, 0]} rotation-x={-Math.PI / 2} receiveShadow>
        <circleGeometry args={[TABLE_R - 0.35, 72]} />
        <meshStandardMaterial color="#23392d" roughness={0.95} />
      </mesh>
      <mesh position={[0, TABLE_Y, 0]} rotation-x={Math.PI / 2}>
        <torusGeometry args={[TABLE_R, 0.035, 12, 96]} />
        <meshStandardMaterial color="#b8913f" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, TABLE_Y / 2, 0]} castShadow>
        <cylinderGeometry args={[0.35, 0.6, TABLE_Y - 0.1, 24]} />
        <meshStandardMaterial color="#2c1a10" roughness={0.6} />
      </mesh>
    </group>
  )
}

function Piles({ deck, discard }: { deck: number; discard: number }) {
  const back = cardBackTexture()
  const pile = (n: number, x: number) => {
    const h = Math.max(0.01, Math.min(n, 60) * 0.006)
    return (
      <group position={[x, TABLE_Y + h / 2 + 0.005, -0.2]}>
        <mesh castShadow>
          <boxGeometry args={[0.5, h, 0.7]} />
          <meshStandardMaterial color="#e8dfc9" />
        </mesh>
        <mesh position={[0, h / 2 + 0.002, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.5, 0.7]} />
          <meshStandardMaterial map={back} />
        </mesh>
      </group>
    )
  }
  return (
    <group>
      {pile(deck, -0.45)}
      {discard > 0 && pile(discard, 0.45)}
    </group>
  )
}

// ───────── 座位上的人 ─────────

function Limb({ from, to, r, color, opacity }: { from: THREE.Vector3; to: THREE.Vector3; r: number; color: string; opacity: number }) {
  const { pos, quat, len } = useMemo(() => {
    const d = to.clone().sub(from)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize())
    return { pos: from.clone().add(to).multiplyScalar(0.5), quat: q, len: d.length() }
  }, [from, to])
  return (
    <mesh position={pos} quaternion={quat} castShadow>
      <capsuleGeometry args={[r, len, 6, 12]} />
      <meshStandardMaterial color={color} roughness={0.85} transparent={opacity < 1} opacity={opacity} />
    </mesh>
  )
}

function Figure({
  coat,
  opacity,
  slump,
  acting,
  reduced,
  seat,
  cards,
}: {
  coat: string
  opacity: number
  slump: boolean
  acting: boolean
  reduced: boolean
  seat: number
  cards: number
}) {
  const body = useRef<THREE.Group>(null)
  const head = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!body.current || !head.current || reduced) return
    const t = clock.elapsedTime + seat * 1.7
    body.current.scale.y = 1 + Math.sin(t * 1.3) * 0.012
    const lean = slump ? 0.55 : acting ? 0.16 : 0.04
    body.current.rotation.x += (lean - body.current.rotation.x) * 0.06
    head.current.rotation.y = Math.sin(t * 0.4) * (acting ? 0.35 : 0.15)
    head.current.rotation.x = acting ? 0.15 + Math.sin(t * 2) * 0.03 : 0.05
  })
  const tr = opacity < 1
  const skin = '#d8b18e'
  const hat = '#1e1a18'
  const sL = new THREE.Vector3(-0.36, 1.62, 0.02)
  const sR = new THREE.Vector3(0.36, 1.62, 0.02)
  // 拿著手牌：雙手舉在胸前；沒有手牌：手放在桌上
  const holding = cards > 0 && !slump
  const eL = holding ? new THREE.Vector3(-0.4, 1.22, 0.3) : new THREE.Vector3(-0.42, 1.18, 0.38)
  const eR = holding ? new THREE.Vector3(0.4, 1.22, 0.3) : new THREE.Vector3(0.42, 1.18, 0.38)
  const hL = holding ? new THREE.Vector3(-0.13, 1.44, 0.56) : new THREE.Vector3(-0.2, TABLE_Y + 0.08, 0.78)
  const hR = holding ? new THREE.Vector3(0.13, 1.44, 0.56) : new THREE.Vector3(0.2, TABLE_Y + 0.08, 0.78)
  return (
    <group>
      {/* 椅子 */}
      <mesh position={[0, 0.72, -0.15]} castShadow>
        <boxGeometry args={[0.85, 0.08, 0.75]} />
        <meshStandardMaterial color="#2a1a10" />
      </mesh>
      <mesh position={[0, 1.35, -0.52]} castShadow>
        <boxGeometry args={[0.85, 1.25, 0.08]} />
        <meshStandardMaterial color="#2a1a10" />
      </mesh>
      {[-0.36, 0.36].map((x) =>
        [0.18, -0.48].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.36, z]}>
            <boxGeometry args={[0.06, 0.72, 0.06]} />
            <meshStandardMaterial color="#20140c" />
          </mesh>
        )),
      )}
      <group ref={body} position={[0, 0.76, -0.1]}>
        <group position={[0, -0.76, 0.1]}>
          {/* 風衣 */}
          <mesh position={[0, 1.2, -0.05]} castShadow>
            <cylinderGeometry args={[0.3, 0.42, 0.95, 20]} />
            <meshStandardMaterial color={coat} roughness={0.9} transparent={tr} opacity={opacity} />
          </mesh>
          <mesh position={[0, 1.62, -0.03]} scale={[1.25, 0.5, 0.9]} castShadow>
            <sphereGeometry args={[0.32, 20, 14]} />
            <meshStandardMaterial color={coat} roughness={0.9} transparent={tr} opacity={opacity} />
          </mesh>
          {/* 領子 */}
          <mesh position={[0, 1.74, 0.02]} rotation-x={-0.2}>
            <coneGeometry args={[0.2, 0.22, 16, 1, true]} />
            <meshStandardMaterial color={coat} side={THREE.DoubleSide} transparent={tr} opacity={opacity} />
          </mesh>
          <Limb from={sL} to={eL} r={0.085} color={coat} opacity={opacity} />
          <Limb from={sR} to={eR} r={0.085} color={coat} opacity={opacity} />
          <Limb from={eL} to={hL} r={0.075} color={coat} opacity={opacity} />
          <Limb from={eR} to={hR} r={0.075} color={coat} opacity={opacity} />
          {[hL, hR].map((h, i) => (
            <mesh key={i} position={[h.x, h.y + 0.02, h.z + 0.05]} castShadow>
              <sphereGeometry args={[0.075, 12, 10]} />
              <meshStandardMaterial color={skin} transparent={tr} opacity={opacity} />
            </mesh>
          ))}
          {holding && <HeldFan n={cards} />}
          {/* 頭與帽子 */}
          <group ref={head} position={[0, 1.98, 0]}>
            <mesh castShadow>
              <sphereGeometry args={[0.19, 24, 18]} />
              <meshStandardMaterial color={skin} roughness={0.7} transparent={tr} opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.13, 0]} castShadow>
              <cylinderGeometry args={[0.34, 0.34, 0.025, 28]} />
              <meshStandardMaterial color={hat} transparent={tr} opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.24, 0]} castShadow>
              <cylinderGeometry args={[0.17, 0.2, 0.2, 24]} />
              <meshStandardMaterial color={hat} transparent={tr} opacity={opacity} />
            </mesh>
            <mesh position={[0, 0.165, 0]}>
              <cylinderGeometry args={[0.205, 0.205, 0.045, 24]} />
              <meshStandardMaterial color="#6b1d17" transparent={tr} opacity={opacity} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  )
}

/** 別人手上的牌：牌背朝外，張數和實際手牌數一樣 */
function HeldFan({ n }: { n: number }) {
  const back = cardBackTexture()
  const k = Math.min(n, 12)
  const spread = Math.min(0.14 * Math.max(0, k - 1), 1.2)
  return (
    <group position={[0, 1.42, 0.6]} rotation-x={-0.25}>
      {Array.from({ length: k }, (_, i) => {
        const a = k > 1 ? -spread / 2 + (spread * i) / (k - 1) : 0
        return (
          <group key={i} rotation-z={-a} position={[0, 0, -i * 0.004]}>
            <mesh position={[0, 0.17, 0]} castShadow>
              <planeGeometry args={[0.2, 0.29]} />
              <meshStandardMaterial map={back} side={THREE.DoubleSide} roughness={0.8} />
            </mesh>
          </group>
        )
      })}
    </group>
  )
}

function IntelRow({ cards, theta }: { cards: Card[]; theta: number }) {
  // 在座位前面的桌上，沿著桌緣排一排
  const r = TABLE_R - 0.85
  const step = 0.19
  return (
    <group>
      {cards.map((c, i) => {
        const off = (i - (cards.length - 1) / 2) * step
        const p = polar(theta + off, r, TABLE_Y + 0.012 + i * 0.001)
        return (
          <mesh key={c.id} position={p} rotation={[-Math.PI / 2, 0, theta + Math.PI]} receiveShadow>
            <planeGeometry args={[0.42, 0.59]} />
            <meshStandardMaterial map={cardTexture(c)} roughness={0.8} />
          </mesh>
        )
      })}
    </group>
  )
}

function Seat({
  p,
  v,
  theta,
  acting,
  aiControlled,
  reduced,
  mode,
}: {
  p: PublicPlayer
  v: GameView
  theta: number
  acting: boolean
  aiControlled: boolean
  reduced: boolean
  mode: ViewMode
}) {
  const plateHost = useContext(PlateHost)
  const me = p.seat === v.me
  const pos = polar(theta, SEAT_R, 0)
  const opacity = p.status === 'alive' ? 1 : p.status === 'dead' ? 0.45 : 0.25
  const ring = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!ring.current) return
    const m = ring.current.material as THREE.MeshStandardMaterial
    m.emissiveIntensity = reduced ? 1.2 : 0.9 + Math.sin(clock.elapsedTime * 4) * 0.5
  })
  const ch = p.character ? CHAR_BY_ID[p.character] : null
  const marks: { text: string; cls: string }[] = []
  if (p.status === 'dead') marks.push({ text: '死亡', cls: 'm-dead' })
  if (p.status === 'out') marks.push({ text: '出局', cls: 'm-dead' })
  if (v.active === p.seat && p.status === 'alive') marks.push({ text: '回合中', cls: 'm-turn' })
  if (v.locks.includes(p.seat)) marks.push({ text: '鎖定', cls: 'm-lock' })
  if (v.diverts.includes(p.seat)) marks.push({ text: '調虎離山', cls: 'm-divert' })
  if (acting) marks.push({ text: '行動中', cls: 'm-wait' })
  if (aiControlled && p.status === 'alive') marks.push({ text: '斷線．AI 代打', cls: 'm-ai' })
  const winner = !!v.result?.winners.includes(p.seat)
  return (
    <group>
      <group position={pos} rotation-y={theta + Math.PI}>
        {!me && (
          <Figure
            coat={COATS[p.seat % COATS.length]}
            opacity={opacity}
            slump={p.status !== 'alive'}
            acting={acting}
            reduced={reduced}
            seat={p.seat}
            cards={p.status === 'alive' ? p.handCount : 0}
          />
        )}
      </group>
      {/* 行動中：桌緣亮起的光 */}
      {(acting || winner) && (
        <mesh ref={ring} position={polar(theta, TABLE_R - 0.18, TABLE_Y + 0.01)} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.32, 0.42, 40]} />
          <meshStandardMaterial color={winner ? '#e9cf7f' : '#c8a24a'} emissive={winner ? '#e9cf7f' : '#c8a24a'} transparent opacity={0.85} />
        </mesh>
      )}
      <IntelRow cards={p.intel} theta={theta} />
      {!(me && mode === 'first') && (
      <Html
        position={me ? polar(theta, TABLE_R + 0.3, TABLE_Y + 0.1) : polar(theta, SEAT_R, 2.85)}
        center
        calculatePosition={mode === 'first' ? clampedPosition : undefined}
          portal={(plateHost ?? undefined) as React.RefObject<HTMLElement> | undefined}
        onOcclude={keepVisible}
        className={`plate ${me ? 'is-me' : ''} ${acting ? 'is-acting' : ''} ${p.status !== 'alive' ? 'is-out' : ''} ${winner ? 'is-winner' : ''}`}
        zIndexRange={[20, 0]}
      >
        <div className="plate-head">
          <b>{p.name}</b>
          {me && <span className="seat-you">你</span>}
          {p.isAI && <span className="seat-ai">電腦</span>}
          <span className="plate-hand">手牌 {p.handCount}</span>
        </div>
        <div className="plate-char">
          {ch ? `${ch.name}${p.charFaceUp ? '' : '（蓋伏）'}` : '角色蓋伏'}
          {p.faction && <span className={`faction f-${p.faction}`}>{FACTION_NAME[p.faction]}</span>}
        </div>
        <IntelSummary cards={p.intel} />
        {marks.length > 0 && (
          <div className="plate-marks">
            {marks.map((m) => (
              <span key={m.text} className={`mark ${m.cls}`}>
                {m.text}
              </span>
            ))}
          </div>
        )}
      </Html>
      )}
    </group>
  )
}

// ───────── 傳遞中的卷宗 ─────────

interface Shown {
  key: string
  method: Method
  seat: number
  landed: boolean
}

function useDossierState(v: GameView): Shown | null {
  const [shown, setShown] = useState<Shown | null>(null)
  const prev = useRef<GameView | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    const p = prev.current
    prev.current = v
    const t = v.trans
    if (t) {
      setShown({ key: `${v.turnNo}-${t.sender}`, method: t.method, seat: t.holder, landed: false })
      return
    }
    if (p?.trans) {
      const to = v.players.find((pl) => pl.intel.length > p.players[pl.seat].intel.length)
      if (to) {
        setShown((s) => (s ? { ...s, seat: to.seat, landed: true } : null))
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setShown(null), 1400)
        return
      }
    }
    setShown((s) => (s?.landed ? s : null))
  }, [v])
  useEffect(() => () => clearTimeout(timer.current), [])
  return shown
}

function Dossier({ v, reduced }: { v: GameView; reduced: boolean }) {
  const shown = useDossierState(v)
  if (!shown) return null
  return <DossierMesh key={shown.key} shown={shown} v={v} reduced={reduced} />
}

function DossierMesh({ shown, v, reduced }: { shown: Shown; v: GameView; reduced: boolean }) {
  const g = useRef<THREE.Group>(null)
  const born = useRef<number | null>(null)
  const n = v.players.length
  const theta = seatAngle(shown.seat, v.me, n)
  const target = useMemo(() => polar(theta, shown.landed ? TABLE_R - 0.85 : TABLE_R - 1.35, shown.landed ? TABLE_Y + 0.03 : TABLE_Y + 0.35), [theta, shown.landed])
  const tex = dossierTexture(shown.method)
  useFrame(({ clock }, dt) => {
    const o = g.current
    if (!o) return
    if (born.current == null) {
      born.current = clock.elapsedTime
      o.position.copy(target)
      o.position.y += 1.2
    }
    const age = clock.elapsedTime - born.current
    const k = reduced ? 1 : 1 - Math.exp(-dt * 5)
    o.position.lerp(target, k)
    o.rotation.y += (theta + Math.PI - o.rotation.y) * k
    // 落地後縮小消失；壓印章的瞬間略為放大
    const s = shown.landed ? Math.max(0.01, o.scale.x - dt * 0.9) : age < 0.35 && !reduced ? 1.25 - age * 0.7 : 1
    o.scale.setScalar(s)
    if (!shown.landed && !reduced) o.position.y += Math.sin(clock.elapsedTime * 2.2) * 0.002
  })
  return (
    <group ref={g}>
      <mesh castShadow>
        <boxGeometry args={[0.9, 0.05, 0.64]} />
        <meshStandardMaterial color="#c49e5e" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.026, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[0.9, 0.64]} />
        <meshStandardMaterial map={tex} roughness={0.85} />
      </mesh>
      <mesh position={[-0.22, 0.01, -0.34]}>
        <boxGeometry args={[0.36, 0.04, 0.08]} />
        <meshStandardMaterial color="#cfac6d" />
      </mesh>
    </group>
  )
}
