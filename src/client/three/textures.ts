import * as THREE from 'three'
import { KIND_NAME, METHOD_NAME } from '../../engine/data'
import type { Card, Method } from '../../engine/types'

// 牌面與印章用 canvas 畫成貼圖：中文直接用瀏覽器的字型，不需要另外下載字體檔

const SERIF = "'Noto Serif TC', 'Songti TC', 'PMingLiU', serif"
const BAND: Record<Card['colour'], string> = { red: '#b0281f', blue: '#2c5a88', black: '#33302c' }
const SEAL: Record<Method, string> = { secret: '密', direct: '直', text: '文' }

const cache = new Map<string, THREE.CanvasTexture>()

function make(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const hit = cache.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d')!)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  cache.set(key, tex)
  return tex
}

/** 字型載入後重畫 */
export function clearTextures() {
  for (const t of cache.values()) t.dispose()
  cache.clear()
}

export function cardTexture(card: Pick<Card, 'kind' | 'colour' | 'method'>) {
  return make(`card-${card.kind}-${card.colour}-${card.method}`, 256, 360, (g) => {
    g.fillStyle = '#e8dfc9'
    g.fillRect(0, 0, 256, 360)
    g.fillStyle = BAND[card.colour]
    g.fillRect(0, 0, 26, 360)
    // 印章
    g.strokeStyle = '#b0281f'
    g.lineWidth = 6
    g.strokeRect(184, 16, 56, 56)
    g.fillStyle = '#b0281f'
    g.font = `900 40px ${SERIF}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(SEAL[card.method], 212, 46)
    // 牌名
    const name = KIND_NAME[card.kind]
    g.fillStyle = '#241d17'
    g.textAlign = 'left'
    g.textBaseline = 'alphabetic'
    if (name.length <= 2) {
      g.font = `900 92px ${SERIF}`
      g.fillText(name, 48, 190)
    } else {
      g.font = `900 64px ${SERIF}`
      g.fillText(name.slice(0, 2), 48, 170)
      g.fillText(name.slice(2), 48, 245)
    }
    g.fillStyle = card.colour === 'black' ? '#6b5d4c' : BAND[card.colour]
    g.font = `700 30px ${SERIF}`
    g.textAlign = 'right'
    g.fillText(card.colour === 'black' ? '假情報' : card.colour === 'red' ? '紅色情報' : '藍色情報', 238, 340)
  })
}

export function cardBackTexture() {
  return make('back', 256, 360, (g) => {
    g.fillStyle = '#4a2f22'
    g.fillRect(0, 0, 256, 360)
    g.strokeStyle = '#c8a24a'
    g.lineWidth = 6
    g.strokeRect(14, 14, 228, 332)
    g.fillStyle = '#c8a24a'
    g.font = `900 96px ${SERIF}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText('風', 128, 140)
    g.fillText('聲', 128, 240)
  })
}

/** 卷宗正面：牛皮紙與「密電／直達／文本」印章 */
export function dossierTexture(method: Method) {
  return make(`dossier-${method}`, 384, 272, (g) => {
    const grd = g.createLinearGradient(0, 0, 384, 272)
    grd.addColorStop(0, '#d9b97c')
    grd.addColorStop(1, '#c09a58')
    g.fillStyle = grd
    g.fillRect(0, 0, 384, 272)
    g.strokeStyle = 'rgba(80,50,20,0.35)'
    g.lineWidth = 2
    for (let y = 60; y < 272; y += 34) {
      g.beginPath()
      g.moveTo(24, y)
      g.lineTo(360, y)
      g.stroke()
    }
    g.save()
    g.translate(192, 150)
    g.rotate(-0.16)
    g.strokeStyle = '#b0281f'
    g.lineWidth = 10
    if (method === 'direct') {
      g.beginPath()
      g.roundRect(-126, -58, 252, 116, 58)
      g.stroke()
    } else {
      g.strokeRect(-126, -58, 252, 116)
      if (method === 'text') g.strokeRect(-110, -44, 220, 88)
    }
    g.fillStyle = '#b0281f'
    g.font = `900 78px ${SERIF}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(METHOD_NAME[method], 0, 6)
    g.restore()
  })
}
