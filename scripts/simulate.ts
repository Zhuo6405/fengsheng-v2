// 用法：npm run sim -- [局數]
import { FACTION_SETUPS } from '../src/engine/data'
import { makeConfig, playOut, skillStats } from '../src/engine/sim'

const N = Number(process.argv[2] ?? 200)
const t0 = Date.now()
const wins: Record<string, number> = { red: 0, blue: 0, neutral: 0, draw: 0 }
let actions = 0
let turns = 0
for (let g = 0; g < N; g++) {
  const n = 3 + (g % 7)
  const setups = FACTION_SETUPS[n]
  const { state, actions: a } = playOut(makeConfig(n, g * 7919 + 13, g % setups.length, g % 3 === 0))
  actions += a
  turns += state.turnNo
  const d = state.result!.declarer
  if (d == null) wins.draw++
  else wins[state.players[d].faction]++
}
const ms = Date.now() - t0
console.log(`${N} 局，${ms} ms（每局 ${(ms / N).toFixed(1)} ms），平均 ${(turns / N).toFixed(1)} 回合、${(actions / N).toFixed(0)} 個動作`)
console.log('宣告勝利者陣營：', wins)
console.log('技能觸發次數：', Object.entries(skillStats).sort((a, b) => b[1] - a[1]))
