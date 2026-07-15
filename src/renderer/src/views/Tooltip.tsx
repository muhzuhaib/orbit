import { useEffect } from 'react'

// Global, elegant tooltips. Instead of the OS's ugly default `title` bubble,
// this mounts ONE styled floating element and, on hover, moves any element's
// `title` into a data attribute (suppressing the native tooltip) and shows our
// own themed chip near it. Works for every `title=…` already in the app — no
// per-component changes needed. The title is copied to aria-label first so
// screen-reader semantics are preserved.
export default function Tooltips(): null {
  useEffect(() => {
    const ATTR = 'data-orbit-tip'
    const el = document.createElement('div')
    el.className = 'orbit-tooltip'
    el.setAttribute('role', 'tooltip')
    el.style.display = 'none'
    document.body.appendChild(el)

    let current: HTMLElement | null = null
    let showTimer: ReturnType<typeof setTimeout> | undefined

    const getTip = (node: HTMLElement): string => {
      const title = node.getAttribute('title')
      if (title && title.trim()) {
        node.setAttribute(ATTR, title)
        if (!node.getAttribute('aria-label')) node.setAttribute('aria-label', title)
        node.removeAttribute('title') // stop the native tooltip
        return title
      }
      return node.getAttribute(ATTR) ?? ''
    }

    const place = (target: HTMLElement): void => {
      const r = target.getBoundingClientRect()
      el.style.display = 'block'
      el.style.visibility = 'hidden'
      const tw = el.offsetWidth
      const th = el.offsetHeight
      const gap = 8
      let top = r.bottom + gap
      if (top + th > window.innerHeight - 4) top = r.top - th - gap // flip above
      let left = r.left + r.width / 2 - tw / 2
      left = Math.max(6, Math.min(left, window.innerWidth - tw - 6))
      el.style.left = `${Math.round(left)}px`
      el.style.top = `${Math.round(Math.max(4, top))}px`
      el.style.visibility = 'visible'
      el.classList.add('show')
    }

    const hide = (): void => {
      clearTimeout(showTimer)
      current = null
      el.classList.remove('show')
      el.style.display = 'none'
    }

    const onOver = (e: PointerEvent): void => {
      const start = e.target as HTMLElement | null
      const node = start?.closest?.(`[title],[${ATTR}]`) as HTMLElement | null
      if (!node || node === current) return
      const tip = getTip(node)
      if (!tip) return
      current = node
      clearTimeout(showTimer)
      showTimer = setTimeout(() => {
        if (current !== node || !node.isConnected) return
        el.textContent = tip
        place(node)
      }, 300)
    }

    const onOut = (e: PointerEvent): void => {
      if (!current) return
      const to = e.relatedTarget as Node | null
      if (to && current.contains(to)) return
      hide()
    }

    document.addEventListener('pointerover', onOver, true)
    document.addEventListener('pointerout', onOut, true)
    document.addEventListener('pointerdown', hide, true)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('blur', hide)

    return () => {
      document.removeEventListener('pointerover', onOver, true)
      document.removeEventListener('pointerout', onOut, true)
      document.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('blur', hide)
      el.remove()
    }
  }, [])
  return null
}
