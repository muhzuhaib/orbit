// Themed, in-app confirm / alert dialogs (replaces the OS-native message boxes
// that clashed with Orbit's look). Promise-based and framework-agnostic: builds
// a small DOM overlay styled with the app's CSS variables, so it automatically
// matches the current light/dark theme and accent. Esc or a backdrop click
// cancels; the primary button can be styled as a destructive "danger" action.

export interface ConfirmOptions {
  detail?: string
  /** primary button label (default "Confirm") */
  confirmLabel?: string
  /** cancel button label (default "Cancel") */
  cancelLabel?: string
  /** style the primary button as destructive (red) */
  danger?: boolean
}

let openCount = 0

export function confirmDialog(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const {
      detail,
      confirmLabel = 'Confirm',
      cancelLabel = 'Cancel',
      danger = true
    } = options

    const backdrop = document.createElement('div')
    backdrop.className = 'confirm-backdrop'

    const modal = document.createElement('div')
    modal.className = 'confirm-modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')

    const iconWrap = document.createElement('div')
    iconWrap.className = `confirm-icon${danger ? ' danger' : ''}`
    iconWrap.textContent = danger ? '⚠' : 'ⓘ'

    const titleEl = document.createElement('div')
    titleEl.className = 'confirm-title'
    titleEl.textContent = message

    const head = document.createElement('div')
    head.className = 'confirm-head'
    head.append(iconWrap, titleEl)
    modal.append(head)

    if (detail) {
      const detailEl = document.createElement('div')
      detailEl.className = 'confirm-detail'
      detailEl.textContent = detail
      modal.append(detailEl)
    }

    const actions = document.createElement('div')
    actions.className = 'confirm-actions'
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'confirm-cancel'
    cancelBtn.textContent = cancelLabel
    const okBtn = document.createElement('button')
    okBtn.className = `confirm-ok${danger ? ' danger' : ''}`
    okBtn.textContent = confirmLabel
    actions.append(cancelBtn, okBtn)
    modal.append(actions)

    backdrop.append(modal)
    document.body.append(backdrop)
    openCount++
    // Trigger the entrance transition on the next frame.
    requestAnimationFrame(() => backdrop.classList.add('open'))
    okBtn.focus()

    const close = (result: boolean) => {
      window.removeEventListener('keydown', onKey)
      backdrop.classList.remove('open')
      openCount = Math.max(0, openCount - 1)
      // Let the fade-out play before removing.
      setTimeout(() => backdrop.remove(), 150)
      resolve(result)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        close(true)
      }
    }
    window.addEventListener('keydown', onKey)
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close(false)
    })
    cancelBtn.addEventListener('click', () => close(false))
    okBtn.addEventListener('click', () => close(true))
  })
}

/** A themed password/PIN prompt. Resolves to the entered string, or null if the
 *  user cancels. Used by the encrypted backup / restore flow. */
export function promptPassword(
  message: string,
  options: { detail?: string; confirmLabel?: string; placeholder?: string } = {}
): Promise<string | null> {
  return new Promise((resolve) => {
    const { detail, confirmLabel = 'Continue', placeholder = 'Password or PIN' } = options
    const backdrop = document.createElement('div')
    backdrop.className = 'confirm-backdrop'
    const modal = document.createElement('div')
    modal.className = 'confirm-modal'
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')

    const titleEl = document.createElement('div')
    titleEl.className = 'confirm-title'
    titleEl.textContent = message
    const head = document.createElement('div')
    head.className = 'confirm-head'
    const iconWrap = document.createElement('div')
    iconWrap.className = 'confirm-icon'
    iconWrap.textContent = '🔒'
    head.append(iconWrap, titleEl)
    modal.append(head)

    if (detail) {
      const detailEl = document.createElement('div')
      detailEl.className = 'confirm-detail'
      detailEl.textContent = detail
      modal.append(detailEl)
    }

    const input = document.createElement('input')
    input.type = 'password'
    input.className = 'confirm-input'
    input.placeholder = placeholder
    input.autocomplete = 'off'
    modal.append(input)

    const actions = document.createElement('div')
    actions.className = 'confirm-actions'
    const cancelBtn = document.createElement('button')
    cancelBtn.className = 'confirm-cancel'
    cancelBtn.textContent = 'Cancel'
    const okBtn = document.createElement('button')
    okBtn.className = 'confirm-ok'
    okBtn.textContent = confirmLabel
    actions.append(cancelBtn, okBtn)
    modal.append(actions)

    backdrop.append(modal)
    document.body.append(backdrop)
    openCount++
    requestAnimationFrame(() => backdrop.classList.add('open'))
    setTimeout(() => input.focus(), 40)

    const close = (result: string | null) => {
      window.removeEventListener('keydown', onKey)
      backdrop.classList.remove('open')
      openCount = Math.max(0, openCount - 1)
      setTimeout(() => backdrop.remove(), 150)
      resolve(result)
    }
    const submit = () => close(input.value ? input.value : null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(null)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        submit()
      }
    }
    window.addEventListener('keydown', onKey)
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop) close(null)
    })
    cancelBtn.addEventListener('click', () => close(null))
    okBtn.addEventListener('click', submit)
  })
}

/** A themed one-button notice (replaces window.alert). */
export function alertDialog(message: string, detail?: string): Promise<void> {
  return confirmDialog(message, {
    detail,
    confirmLabel: 'OK',
    cancelLabel: 'Close',
    danger: false
  }).then(() => undefined)
}
