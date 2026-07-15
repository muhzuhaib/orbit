// Beta feature flags (v0.10.0-beta.1).
//
// Stored in localStorage under NEW keys only — v0.9.3 never reads them, so a user
// who reverts to the previous installer keeps a fully working app. Each new
// feature in this beta has its own on/off toggle (Settings → Beta features); a
// user who dislikes one can switch it off without losing anything.

export type BetaFeature =
  | 'cost-preview'
  | 'autopilot'
  | 'council'
  | 'benchmarks'
  | 'section-rail'

export interface BetaFeatureDef {
  id: BetaFeature
  label: string
  description: string
}

// Order shown in Settings.
export const BETA_FEATURES: BetaFeatureDef[] = [
  {
    id: 'cost-preview',
    label: 'Cost preview in the composer',
    description:
      'Before you send a message, show a rough estimate of what it will cost with the selected model. Free / local models show “free”.'
  },
  {
    id: 'autopilot',
    label: 'Autopilot (smart model routing)',
    description:
      'Adds an “Autopilot” choice at the top of the model picker. Orbit judges how hard each message is and routes easy ones to a fast/free model and hard ones to your best model, then shows which model answered. Tracks how much you saved.'
  },
  {
    id: 'council',
    label: 'Council mode (in Compare)',
    description:
      'A new “Council” tab in Compare: send your prompt to 2–3 models, then a judge model writes a verdict — where they agree, where they disagree, and a final combined answer.'
  },
  {
    id: 'benchmarks',
    label: 'Personal benchmarks',
    description:
      'Save your own test prompts and run them across models you pick. A judge scores each answer 1–10 and shows a results table with speed and cost.'
  },
  {
    id: 'section-rail',
    label: 'Section icon rail (full-width mode)',
    description:
      'When the sidebar is hidden (100% width), show a slim vertical rail of section icons on the left so you can jump between Chats, Cowork, Code, Studio, Swarm and the rest without first bringing the full sidebar back. Settings sits at the bottom.'
  }
]

const KEY = (id: BetaFeature): string => `orbit-beta-${id}`

// These features graduated from beta to stable (v0.10.7): they are now
// PERMANENTLY ON for everyone and no longer have on/off switches in Settings.
// isBetaOn always returns true so every existing `useBetaFlag(...)` call site
// keeps working untouched. The old per-feature localStorage keys are left
// unused (additive → a downgrade to a previous installer still works).
export function isBetaOn(_id: BetaFeature): boolean {
  return true
}

export function setBetaOn(id: BetaFeature, on: boolean): void {
  localStorage.setItem(KEY(id), on ? '1' : '0')
  // let open views react without a reload
  window.dispatchEvent(new CustomEvent('orbit-beta-changed', { detail: { id, on } }))
}

// React helper: subscribe to a single flag and re-render when it changes.
import { useEffect, useState } from 'react'

export function useBetaFlag(id: BetaFeature): boolean {
  const [on, setOn] = useState(() => isBetaOn(id))
  useEffect(() => {
    const handler = (): void => setOn(isBetaOn(id))
    window.addEventListener('orbit-beta-changed', handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener('orbit-beta-changed', handler)
      window.removeEventListener('storage', handler)
    }
  }, [id])
  return on
}
