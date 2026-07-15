import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/types'

// A slim, dismissible banner driven by the main-process auto-updater. It stays
// quiet until a new version is actually downloading or ready to install, so it
// never nags — when a version is ready it offers a one-click "Restart to update".
export default function UpdateBanner(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>({ status: 'idle' })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    return window.api.updates.onStatus((s) => {
      setStatus(s)
      if (s.status === 'ready' || s.status === 'downloading') setDismissed(false)
    })
  }, [])

  if (dismissed) return null

  if (status.status === 'downloading') {
    return (
      <div className="update-banner">
        <span className="update-spinner" />
        <span>Downloading a new version… {status.percent}%</span>
      </div>
    )
  }

  if (status.status === 'ready') {
    return (
      <div className="update-banner ready">
        <span>✨ Orbit {status.version} is ready to install.</span>
        <button className="update-btn" onClick={() => window.api.updates.restart()}>
          Restart to update
        </button>
        <button className="update-dismiss" title="Later" onClick={() => setDismissed(true)}>
          ✕
        </button>
      </div>
    )
  }

  return null
}
