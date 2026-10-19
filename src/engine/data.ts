import type { Card, CardKind, CharacterDef, Colour, Faction, Method } from './types'

export const KIND_NAME: Record<CardKind, string> = {
  lock: '鎖定',
  divert: '調虎離山',
  intercept: '截獲',
  return: '退回',
  decrypt: '破譯',
  burn: '燒毀',
  counter: '識破',
  probe: '試探',
  chaos: '真偽莫辨',
}

export const KIND_DESC: Record<CardKind, string> = {
  lock: '自己回合使用。本回合傳出的情報若傳到該玩家，他必須接收。',
  divert: '情報傳遞時使用。指定一位玩家不參與本次傳遞（不能指定傳出者或被鎖定者）。',
  intercept: '他人回合的情報傳遞時使用。直接獲得傳遞中的情報。',
  return: '情報傳到你時使用。情報改為反方向傳遞（被鎖定時無效）。',
  decrypt: '情報傳到你時使用。先檢視情報內容再決定是否接收。',
  burn: '燒毀任意一位玩家面前的一張假情報。',
  counter: '當一位玩家使用卡牌時使用，令該卡牌無效。識破也能識破識破。',
  probe: '自己回合使用。面朝下交給一位玩家，依他的真實身份行動。',
  chaos: '自己回合使用。從牌庫頂翻出等同存活人數的牌，從你開始每人隨機選一張作為情報。',
}

export const METHOD_NAME: Record<Method, string> = {
  secret: '密電',
  direct: '直達',
  text: '文本',
}

export const COLOUR_NAME: Record<Colour, string> = {
  red: '紅',
  blue: '藍',
  black: '假',
}

export const FACTION_NAME: Record<Faction, string> = {
  red: '潛伏戰線',
  blue: '軍情局',
  neutral: '特工',
}

// [種類, 傳遞方式, 紅, 藍, 黑]
const SPEC: [CardKind, Method, number, number, number][] = [
  ['lock', 'direct', 3, 3, 6],
  ['divert', 'text', 2, 2, 2],
  ['intercept', 'secret', 1, 1, 6],
  ['return', 'text', 3, 3, 2],
  ['decrypt', 'secret', 2, 2, 2],
  ['burn', 'direct', 2, 2, 2],
  ['counter', 'direct', 5, 5, 4],
  ['probe', 'secret', 6, 6, 6],
  ['chaos', 'text', 1, 1, 1],
]

/** 建立 81 張遊戲牌 */
export function buildCards(): Card[] {
  const cards: Card[] = []
  let id = 0
  for (const [kind, method, r, b, k] of SPEC) {
    if (kind === 'probe') continue
    const counts: [Colour, number][] = [
      ['red', r],
      ['blue', b],
      ['black', k],
    ]
    for (const [colour, n] of counts) {
      for (let i = 0; i < n; i++) cards.push({ id: id++, kind, method, colour })
    }
  }
  // 試探：每個陣營 6 張（紅藍黑各 2 張，其中抽二、棄一各 1 張）
  const factions: Faction[] = ['red', 'blue', 'neutral']
  const colours: Colour[] = ['red', 'blue', 'black']
  for (const guess of factions) {
    for (const colour of colours) {
      for (const effect of ['draw2', 'discard1'] as const) {
        cards.push({ id: id++, kind: 'probe', method: 'secret', colour, probe: { guess, effect } })
      }
    }
  }
  return cards
}

/** 各人數可用的陣營配置 [潛伏, 軍情, 特工] */
export const FACTION_SETUPS: Record<number, [number, number, number][]> = {
  3: [[1, 1, 1]],
  4: [
    [1, 1, 2],
    [2, 2, 0],
  ],
  5: [[2, 2, 1]],
  6: [
    [2, 2, 2],
    [3, 3, 0],
  ],
  7: [
    [3, 3, 1],
    [2, 2, 3],
  ],
  8: [[3, 3, 2]],
  9: [[3, 3, 3]],
}

export const CHARACTERS: CharacterDef[] = [
  // ── 潛伏角色（開局蓋伏）──
  {
    id: 'laogui',
    name: '老鬼',
    gender: 'female',
    hidden: true,
    skills: [
      '被試探時翻開此角色，抽二張牌。',
      '被試探時可以隱瞞身份。',
      '死亡時可把全部手牌交給一位玩家，他隨機選三張作為情報。',
    ],
    missionText: '當你死亡時，手牌中有四張或以上的紅色卡牌。',
    mission: { type: 'deathHandRed', n: 4 },
  },
  {
    id: 'yidianyuan',
    name: '譯電員',
    gender: 'female',
    hidden: true,
    skills: ['情報傳到你時可翻開此角色：抽一張牌，並先檢視情報。', '有情報被破譯時，可蓋伏此角色。'],
    missionText: '獲得三張或以上的藍色情報。',
    mission: { type: 'intel', colour: 'blue', n: 3 },
  },
  {
    id: 'laoqiang',
    name: '老槍',
    gender: 'male',
    hidden: true,
    skills: ['被鎖定或試探時可翻開此角色：抽二張牌。', '蓋伏此角色：蓋伏另一位玩家的角色，你們互看身份牌。'],
    missionText: '獲得三張或以上的紅色情報。',
    mission: { type: 'intel', colour: 'red', n: 3 },
  },
  {
    id: 'shanling',
    name: '閃靈',
    gender: 'female',
    hidden: true,
    skills: ['翻開此角色：燒毀另一位玩家的三張情報。'],
    missionText: '潛伏戰線全滅。',
    mission: { type: 'wipeout', faction: 'red' },
  },
  {
    id: 'heimeigui',
    name: '黑玫瑰',
    gender: 'female',
    hidden: true,
    skills: ['翻開此角色：展示牌庫頂一張牌，若為黑色可在一位玩家面前放最多三張假情報，否則只能放一張。'],
    missionText: '軍情局全滅。',
    mission: { type: 'wipeout', faction: 'blue' },
  },
  {
    id: 'emeifeng',
    name: '峨嵋風',
    gender: 'male',
    hidden: true,
    skills: ['翻開此角色：視為使用截獲。', '他人獲得你傳出的假情報時，可燒毀你或一位女性的一張假情報。'],
    missionText: '獲得三張或以上的藍色情報。',
    mission: { type: 'intel', colour: 'blue', n: 3 },
  },
  {
    id: 'laojin',
    name: '老金',
    gender: 'male',
    hidden: true,
    skills: [
      '你的卡牌被識破時可翻開此角色：抽五張牌，再把二張手牌放回牌庫頂。',
      '獲得假情報時，可再放一張假情報到自己面前並蓋伏此角色，然後在任意玩家面前各放一張情報。',
    ],
    missionText: '手牌中同時有三張紅色與三張藍色卡牌。',
    mission: { type: 'handColours', red: 3, blue: 3 },
  },
  // ── 公開角色 ──
  {
    id: 'chuzhang',
    name: '情報處長',
    gender: 'male',
    hidden: false,
    skills: ['有玩家被試探時，你可抽一張牌，然後棄一張手牌或燒毀你的一張非假情報。'],
    missionText: '獲得三張或以上的紅色情報。',
    mission: { type: 'intel', colour: 'red', n: 3 },
  },
  {
    id: 'shashou',
    name: '職業殺手',
    gender: 'male',
    hidden: false,
    skills: ['他人獲得你傳出的假情報時，可在他面前再放一張假情報。', '你的識破可以當作鎖定使用。'],
    missionText: '親手讓一位玩家成為第二位或之後死亡的玩家。',
    mission: { type: 'killer' },
  },
  {
    id: 'mengmian',
    name: '禮服蒙面人',
    gender: 'male',
    hidden: false,
    skills: ['獲得假情報時可抽二張牌。', '一位女性死亡時，可翻開身份牌並燒毀她的二張假情報來救她。'],
    missionText: '一位女性宣告勝利（場上沒有女性時：殺掉除自己外所有玩家）。',
    mission: { type: 'femaleDeclares' },
  },
  {
    id: 'qibai',
    name: '柒佰',
    gender: 'male',
    hidden: false,
    skills: [
      '你可以在他人回合使用鎖定。',
      '使用鎖定時抽二張牌，然後把一張手牌交給另一位玩家。',
      '宣告勝利時，選擇一位女性一同勝利。',
    ],
    missionText: '獲得五張非假情報。',
    mission: { type: 'nonBlack', n: 5 },
  },
  {
    id: 'daofeng',
    name: '刀鋒',
    gender: 'male',
    hidden: false,
    skills: ['你的鎖定不能被識破。', '你的試探可以當作鎖定使用。', '有玩家死亡時可抽二張牌，再交一張手牌給左手玩家。'],
    missionText: '潛伏戰線全滅。',
    mission: { type: 'wipeout', faction: 'red' },
  },
  {
    id: 'dameinv',
    name: '大美女',
    gender: 'female',
    hidden: false,
    skills: ['抽牌階段改為抽三張，再放一張回牌庫頂。', '翻開身份牌：燒毀任意玩家一張假情報。'],
    missionText: '一位男性角色宣告勝利時，你的假情報不超過一張（場上沒有男性時：殺掉除自己外所有玩家）。',
    mission: { type: 'maleDeclaresLowBlack' },
  },
  {
    id: 'liujie',
    name: '六姐',
    gender: 'female',
    hidden: false,
    skills: ['試探一位玩家時可抽取他一張手牌。', '有玩家死亡時，可抽取他一張手牌作為情報。'],
    missionText: '獲得六張情報。',
    mission: { type: 'totalIntel', n: 6 },
  },
  {
    id: 'xiaomage',
    name: '小馬哥',
    gender: 'male',
    hidden: false,
    skills: ['獲得他人傳出的假情報時，抽一張牌，並可在一位玩家面前放一張假情報。'],
    missionText: '軍情局全滅。',
    mission: { type: 'wipeout', faction: 'blue' },
  },
  {
    id: 'guaidao',
    name: '怪盜阿十',
    gender: 'male',
    hidden: false,
    skills: ['他人獲得你傳出的假情報時，可抽取他一張手牌。', '你獲得他人傳出的假情報時，可抽取他一張手牌。'],
    missionText: '手牌達到十張或以上。',
    mission: { type: 'handSize', n: 10 },
  },
  {
    id: 'beileimao',
    name: '貝雷帽',
    gender: 'male',
    hidden: false,
    skills: ['你可以指定自己非直達情報的傳遞方向。', '捨棄一張黑色手牌：視為使用鎖定。'],
    missionText: '遊戲只剩下你和另一位玩家。',
    mission: { type: 'lastTwo' },
  },
  {
    id: 'xiaobai',
    name: '小白',
    gender: 'both',
    hidden: false,
    skills: ['同時視為男性與女性。', '把三張手牌交給一位玩家，然後獲得他面前一張情報。', '獲得六張或以上情報時，你輸掉遊戲。'],
    missionText: '你第一個死亡，或潛伏戰線與軍情局其中一方全滅。',
    mission: { type: 'firstDeathOrWipe' },
  },
]

export const CHAR_BY_ID: Record<string, CharacterDef> = Object.fromEntries(CHARACTERS.map((c) => [c.id, c]))
