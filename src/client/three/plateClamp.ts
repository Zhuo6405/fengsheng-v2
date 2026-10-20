import * as THREE from 'three'

// 第一人稱時，名牌如果跑到畫面外（或在鏡頭後面），就貼在畫面左右邊緣，不要消失

const world = new THREE.Vector3()
const cam = new THREE.Vector3()
const ndc = new THREE.Vector3()
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))

export function clampedPosition(el: THREE.Object3D, camera: THREE.Camera, size: { width: number; height: number }): [number, number] {
  world.setFromMatrixPosition(el.matrixWorld)
  cam.copy(world).applyMatrix4(camera.matrixWorldInverse)
  ndc.copy(world).project(camera)
  const w = size.width
  const h = size.height
  // 名牌大約 220×110，留一點邊
  const mx = Math.min(115, w / 2)
  const myTop = 58
  const myBottom = Math.max(myTop, h * 0.62)
  let x = (ndc.x * 0.5 + 0.5) * w
  let y = (-ndc.y * 0.5 + 0.5) * h
  const behind = cam.z > 0
  if (behind || x < mx || x > w - mx) {
    // 畫面外：貼在左右邊緣，越偏到旁邊／後面的人放越低，避免疊在一起
    const angle = Math.abs(Math.atan2(cam.x, -cam.z))
    const persp = camera as THREE.PerspectiveCamera
    const halfFov = Math.atan(Math.tan(((persp.fov ?? 60) * Math.PI) / 360) * (persp.aspect ?? w / h))
    const t = clamp((angle - halfFov * 0.7) / (Math.PI - halfFov * 0.7), 0, 1)
    x = cam.x >= 0 ? w : 0
    y = h * (0.08 + 0.95 * t)
  }
  return [clamp(x, mx, w - mx), clamp(y, myTop, myBottom)]
}

/** drei 的 Html 預設會把鏡頭後面的元素藏起來；給它一個空的回呼就不會藏 */
export const keepVisible = () => {}
