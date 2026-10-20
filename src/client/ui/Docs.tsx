import { lazy, Suspense, useEffect, useState } from 'react'

const DocBody = lazy(() => import('./DocBody'))

type Which = 'guide' | 'spec' | null

/** 「遊玩說明」「規格書」兩個按鈕，點開在網站內閱讀 */
export function DocsButtons() {
  const [open, setOpen] = useState<Which>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('keydown', onKey)
    // 開著的時候背景不跟著捲動；關掉後通知 3D 牌桌重新量尺寸（手機網址列伸縮後畫面才不會空白）
    document.documentElement.classList.add('doc-open')
    return () => {
      window.removeEventListener('keydown', onKey)
      document.documentElement.classList.remove('doc-open')
      window.scrollTo(0, 0)
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    }
  }, [open])
  return (
    <span className="docs-btns">
      <button type="button" className="ghost" onClick={() => setOpen('guide')}>
        遊玩說明
      </button>
      <button type="button" className="ghost" onClick={() => setOpen('spec')}>
        規格書
      </button>
      {open && (
        <div className="overlay doc-overlay" role="dialog" aria-modal="true" aria-label={open === 'guide' ? '遊玩說明' : '規格書'} onClick={() => setOpen(null)}>
          <article className="doc" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="doc-close" onClick={() => setOpen(null)} aria-label="關閉">
              關閉
            </button>
            <Suspense fallback={<p>載入中…</p>}>
              <DocBody which={open} />
            </Suspense>
          </article>
        </div>
      )}
    </span>
  )
}
