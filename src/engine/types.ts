// 風聲（108 張版）規則引擎的資料型別
// 引擎是純函式：同一份程式碼給單機、房主（P2P 權威端）與 AI 使用。

export type Colour = 'red' | 'blue' | 'black'
/** 密電 / 直達 / 文本 */
export type Method = 'secret' | 'direct' | 'text'
export type CardKind =
  | 'lock' // 鎖定
  | 'divert' // 調虎離山
  | 'intercept' // 截獲
  | 'return' // 退回
  | 'decrypt' // 破譯
  | 'burn' // 燒毀
  | 'counter' // 識破
  | 'probe' // 試探
  | 'chaos' // 真偽莫辨

/** 潛伏戰線 / 軍情局 / 特工 */
export type Faction = 'red' | 'blue' | 'neutral'

export interface ProbeSpec {
  guess: Faction
  /** 猜中時：抽二張 / 棄一張 */
  effect: 'draw2' | 'discard1'
}

export interface Card {
  id: number
  kind: CardKind
  colour: Colour
  method: Method
  probe?: ProbeSpec
}

export type Gender = 'male' | 'female' | 'both'

export type Mission =
  | { type: 'intel'; colour: 'red' | 'blue'; n: number }
  | { type: 'nonBlack'; n: number }
  | { type: 'totalIntel'; n: number }
  | { type: 'handSize'; n: number }
  | { type: 'handColours'; red: number; blue: number }
  | { type: 'wipeout'; faction: 'red' | 'blue' }
  | { type: 'deathHandRed'; n: number }
  | { type: 'killer' }
  | { type: 'femaleDeclares' }
  | { type: 'maleDeclaresLowBlack' }
  | { type: 'lastTwo' }
  | { type: 'firstDeathOrWipe' }

export interface CharacterDef {
  id: string
  name: string
  gender: Gender
  /** 潛伏角色：開局蓋伏 */
  hidden: boolean
  skills: string[]
  missionText: string
  mission: Mission
}

export type PlayerStatus = 'alive' | 'dead' | 'out'

export interface Player {
  id: string
  name: string
  isAI: boolean
  seat: number
  faction: Faction
  character: string | null
  charOptions: string[]
  charFaceUp: boolean
  hand: number[]
  intel: number[]
  status: PlayerStatus
  /** 身份牌已公開（禮服蒙面人、大美女的技能） */
  identityRevealed: boolean
}

export interface PlayerSeed {
  id: string
  name: string
  isAI: boolean
}

export interface GameConfig {
  players: PlayerSeed[]
  /** [潛伏戰線, 軍情局, 特工] */
  factions: [number, number, number]
  neutralAlliance: boolean
  seed: number
}

export interface StackItem {
  uid: number
  card: number
  /** 這次使用的效果（可能是「當作鎖定使用」） */
  kind: CardKind
  user: number
  /** 這張牌原本的種類（當作其他牌使用時才和 kind 不同） */
  printed: CardKind
  uncounterable: boolean
  target?: number
  /** 燒毀時指定的情報 / 識破時指定的堆疊項目 uid */
  targetRef?: number
  countered: boolean
}

export interface Transmission {
  card: number
  sender: number
  method: Method
  dir: 1 | -1
  holder: number
  target: number | null
  stage: 'hopStart' | 'A' | 'B' | 'decide'
  /** 已經看過情報內容的玩家 */
  peeked: number[]
  toSender: boolean
  returned: boolean
  obtainedBy: number | null
  hops: number
}

/** 需要某位玩家回答的問題（技能、試探棄牌、真偽莫辨選牌…） */
export type AskChoice =
  | { kind: 'confirm' }
  | { kind: 'options'; options: { id: string; label: string }[] }
  | { kind: 'player'; seats: number[] }
  /** 從一組牌中選：手牌、某人的情報，或真偽莫辨的蓋牌位置（slots） */
  | { kind: 'cards'; zone: 'hand' | 'intel' | 'slots'; owner: number | null; ids: number[]; min: number; max: number }

export interface Ask {
  k: 'ask'
  player: number
  /** 回答後要執行的步驟 */
  step: string
  /** 顯示用：技能或來源名稱 */
  title: string
  prompt: string
  choice: AskChoice
  canSkip: boolean
  data: Record<string, unknown>
}

/** 引擎自動執行的步驟 */
export interface AutoStep {
  k: 'auto'
  step: string
  data: Record<string, unknown>
}

export type QItem = Ask | AutoStep

/** 情報的來源：傳遞（含截獲）、真偽莫辨、技能放置 */
export type ObtainCause = { by: 'trans'; sender: number } | { by: 'chaos'; user: number } | { by: 'skill'; user: number }

export interface LogEntry {
  seq: number
  text: string
  /** null = 所有人可見 */
  vis: number[] | null
  turn: number
}

export interface GameResult {
  winners: number[]
  declarer: number | null
  reason: string
}

export interface GameState {
  config: GameConfig
  cards: Card[]
  players: Player[]
  deck: number[]
  discard: number[]
  rng: number
  phase: 'choose_character' | 'play' | 'transmit' | 'over'
  active: number
  turnNo: number
  locks: number[]
  diverts: number[]
  trans: Transmission | null
  stack: StackItem[]
  window: 'hopA' | 'hopB' | null
  prio: { current: number; passes: number } | null
  reopenFrom: number | null
  /** 待處理的問題與自動步驟（前面的先處理） */
  q: QItem[]
  /** 誰讓這位玩家拿到第三張假情報（職業殺手） */
  pendingKiller: Record<number, number | null>
  log: LogEntry[]
  deaths: number[]
  /** 某位玩家「親手」造成第二位以後的死亡（職業殺手） */
  killerCredit: number[]
  /** 死亡時達成機密任務的玩家（老鬼） */
  deathWins: number[]
  result: GameResult | null
  seq: number
}

export type Ctx = 'play' | 'hopA' | 'hopB' | 'resp'

export type AskView = Omit<Ask, 'data' | 'k' | 'step'>

export type Decision =
  | { type: 'choose_character'; player: number; options: string[] }
  | { type: 'play'; player: number }
  | { type: 'priority'; player: number; ctx: Ctx }
  | { type: 'accept'; player: number }
  | { type: 'ask'; player: number; ask: AskView }

export type Action =
  | { type: 'choose_character'; character: string }
  | { type: 'play_card'; card: number; target?: number; targetRef?: number; as?: CardKind }
  /** dir：貝雷帽可以指定密電／文本往哪邊傳 */
  | { type: 'send'; card: number; target?: number; dir?: 1 | -1 }
  | { type: 'pass' }
  | { type: 'accept' }
  | { type: 'decline' }
  | { type: 'use_skill'; skill: string }
  /** 回答 Ask：options 傳 id，player 傳座位，cards 傳 id 陣列，confirm 傳 true */
  | { type: 'answer'; value: string | number | number[] | true }
  | { type: 'skip' }

/** 某張手牌在目前時機可以怎麼用 */
export interface LegalPlay {
  card: number
  /** 這次使用的效果 */
  kind: CardKind
  /** 當作其他牌使用（例：職業殺手的識破當鎖定） */
  as?: boolean
  uncounterable?: boolean
  /** 需要指定的目標玩家（座位） */
  targets?: number[]
  /** 燒毀：可選的情報；識破：可選的堆疊項目 */
  refs?: { target: number; ref: number }[]
}

/** 現在可以主動發動的角色技能 */
export interface LegalSkill {
  id: string
  label: string
}
