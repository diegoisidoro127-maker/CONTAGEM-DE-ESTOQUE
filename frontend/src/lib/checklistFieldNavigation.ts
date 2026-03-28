import type { KeyboardEvent } from 'react'

/** Raiz da lista (tbody ou div que envolve os cards) para navegação com setas. */
export const CHECKLIST_NAV_ROOT_ATTR = 'data-checklist-nav-root'

function shouldLetArrowMoveCursorInsideField(el: HTMLElement, key: 'ArrowRight' | 'ArrowLeft'): boolean {
  if (el instanceof HTMLSelectElement) return false
  if (el instanceof HTMLInputElement) {
    const t = el.type
    if (t === 'date' || t === 'datetime-local' || t === 'month' || t === 'week') return false
    if (t === 'number') return false
    if (t !== 'text' && t !== 'search' && t !== 'tel' && t !== 'url' && t !== '') return false
    const len = el.value.length
    const end = el.selectionEnd ?? 0
    const start = el.selectionStart ?? 0
    if (key === 'ArrowRight') return len > 0 && end < len
    return start > 0
  }
  if (el instanceof HTMLTextAreaElement) {
    const len = el.value.length
    const end = el.selectionEnd ?? 0
    const start = el.selectionStart ?? 0
    if (key === 'ArrowRight') return end < len
    return start > 0
  }
  return false
}

export function focusAdjacentChecklistField(
  container: HTMLElement | null,
  current: HTMLElement,
  direction: 1 | -1,
): void {
  if (!container) return
  const focusables = Array.from(
    container.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
    ),
  ).filter((el) => {
    const st = window.getComputedStyle(el)
    return st.display !== 'none' && st.visibility !== 'hidden'
  })
  const idx = focusables.indexOf(current as HTMLInputElement)
  if (idx < 0) return
  const next = focusables[idx + direction]
  if (!next) return
  next.focus()
  if (
    next instanceof HTMLInputElement &&
    (next.type === 'text' || next.type === 'search' || next.type === 'tel' || next.type === 'url' || next.type === '')
  ) {
    try {
      next.select()
    } catch {
      /* ignore */
    }
  }
}

/**
 * Setas ← / → mudam o foco para o campo anterior/próximo (como Tab / Shift+Tab).
 * Em texto longo, a seta só “pula” quando o cursor está no início/fim para não atrapalhar a edição.
 */
export function handleChecklistFieldNavKeyDown(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
  const target = e.target as HTMLElement
  if (!target.matches('input, select, textarea')) return
  if (e.altKey || e.metaKey || e.ctrlKey) return

  const key = e.key as 'ArrowRight' | 'ArrowLeft'
  if (shouldLetArrowMoveCursorInsideField(target, key)) return

  e.preventDefault()
  const root =
    (e.currentTarget as HTMLElement).closest(`[${CHECKLIST_NAV_ROOT_ATTR}]`) ??
    (e.currentTarget as HTMLElement)
  focusAdjacentChecklistField(root, target, key === 'ArrowRight' ? 1 : -1)
}
