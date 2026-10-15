export type Stage = 'applied' | 'screen' | 'interview' | 'offer' | 'rejected' | 'closed'

export type Step = { stage: Stage; on: string }

export type Application = {
  id: string
  company: string
  role: string
  url: string | null
  resume: string | null
  stage: Stage
  history: Step[]
  note: string | null
}

export type Tracker = { v: 1; applications: Application[]; hidden: string[] }

export type Lead = {
  id: string
  company: string
  title: string
  url: string
  location: string
  country: string
  sponsor: boolean
  remote: boolean
  salary: string | null
  posted: string | null
  fit: number
  why: string | null
  found_ms: number
}

export type Leads = { v: 1; scanned_ms: number | null; query: string | null; leads: Lead[] }

export type Profile = { name: string; title: string; place: string | null; skills: string[]; english: string | null }

export type FileEntry = { dir: string; name: string; mtime_ms: number }

export type Busy = { kind: 'init' | 'scan' | 'tailor'; label: string; since_ms: number }

export type Pending = { busy: Busy; text: string; turnId: string | null; done: string | null }

export type Folder = { root: string; profile: Profile | null; files: FileEntry[]; tracker: Tracker; leads: Leads }

declare module 'claude-code' {
  interface PluginState {
    'job-hunt': {
      folder: Folder
      now: number
      pending: Pending | null
      isDemo: boolean
    }
  }
}
