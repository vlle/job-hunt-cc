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

export type Variant = { name: string; path: string; formats: string[]; updated_ms: number; sent: number }

export type Busy = { kind: 'scan' | 'tailor'; label: string; since_ms: number }

export type Config = { target: string; exclude: string; facts: string }

export type PanelProps = {
  now: number
  hasRoot: boolean
  profile: Profile | null
  variants: Variant[]
  applications: Application[]
  leads: Lead[]
  scanned_ms: number | null
  busy: Busy | null
  columns: number
  isDocked: boolean
}

export type ApplicationInput = {
  company: string
  role: string
  url?: string | null
  resume?: string | null
  on?: string | null
  note?: string | null
}

export type Change = { tracker: Tracker; application: Application }

export const DAY_MS = 86_400_000
export const SILENCE_DAYS = 21
export const FRESH_MS = 3 * DAY_MS
export const STAGES: readonly Stage[] = ['applied', 'screen', 'interview', 'offer', 'rejected', 'closed']
export const FUNNEL: readonly Stage[] = ['applied', 'screen', 'interview', 'offer']
export const STAGE_LABEL: Record<Stage, string> = {
  applied: 'applied',
  screen: 'screen',
  interview: 'interview',
  offer: 'offer',
  rejected: 'rejected',
  closed: 'closed',
}
export const EMPTY_TRACKER: Tracker = { v: 1, applications: [], hidden: [] }
export const EMPTY_LEADS: Leads = { v: 1, scanned_ms: null, query: null, leads: [] }
export const USAGE = 'usage: /hunt [scan | anon | apply|tailor|hide|open|next|reject|close <row>]'

const LEAD_TTL_MS = 30 * DAY_MS
const SCAN_PER_KIND = 10
const REMOTE_REGIONS = new Set(['EU', 'WW'])
const REMOTE_PLACE = /remote|home[\s-]?based/i
const ROW_KINDS: Record<string, readonly string[]> = {
  apply: ['lead'],
  tailor: ['lead'],
  hide: ['lead'],
  open: ['app', 'lead'],
  next: ['app'],
  reject: ['app'],
  close: ['app'],
}
const RESUME_FILE = /^resume(?:-([\w-]+))?\.(txt|html|md)$/i
const PDF_FILE = /\.pdf$/i
const FORMAT_ORDER = ['txt', 'html', 'md', 'pdf']
const SKILL_ROWS = 3
const SKILLS_HEAD = /^(?:technical |core |key )?skills:?$/i
const SECTION_HEAD = /^[A-Z][A-Z &/-]{2,}$/
const CONTACT_SEPARATOR = /\s+[·•|]\s+/
const SHORT_SKILL: Record<string, string> = {
  PostgreSQL: 'PG',
  'Apache Kafka': 'Kafka',
  ClickHouse: 'CH',
  Kubernetes: 'k8s',
}

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value)
}

export function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function idOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

export function urlKeyOf(url: string): string {
  return url
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/^https?:\/\/(www\.)?/i, '')
    .toLowerCase()
}

export function todayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

export function daysSinceOf(day: string, now: number): number {
  const at = Date.parse(`${day}T00:00:00Z`)

  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / DAY_MS)) : 0
}

export function shortDayOf(day: string | null): string {
  return isDay(day) ? `${day.slice(8, 10)}.${day.slice(5, 7)}` : '—'
}

export function trackerOf(text: string): Tracker | undefined {
  if (text.trim() === '') {
    return EMPTY_TRACKER
  }
  const raw = recordOf(jsonOf(text))
  if (!raw) {
    return undefined
  }
  const applications = arrayOf(raw.applications)
    .map(applicationOf)
    .filter((app): app is Application => app !== undefined)
  const hidden = arrayOf(raw.hidden).filter((id): id is string => typeof id === 'string')

  return { v: 1, applications, hidden }
}

export function leadsOf(text: string): Leads | undefined {
  if (text.trim() === '') {
    return EMPTY_LEADS
  }
  const raw = recordOf(jsonOf(text))
  if (!raw) {
    return undefined
  }
  const leads = arrayOf(raw.leads)
    .map(value => leadOf(value, 0))
    .filter((lead): lead is Lead => lead !== undefined)

  return {
    v: 1,
    scanned_ms: typeof raw.scanned_ms === 'number' ? raw.scanned_ms : null,
    query: textOf(raw.query),
    leads,
  }
}

export function leadOf(value: unknown, now: number): Lead | undefined {
  const raw = recordOf(value)
  const company = textOf(raw?.company)
  const title = textOf(raw?.title)
  const url = textOf(raw?.url)
  if (!raw || !company || !title || !url || !/^https?:\/\//i.test(url)) {
    return undefined
  }
  const fit = typeof raw.fit === 'number' && Number.isFinite(raw.fit) ? Math.round(Math.min(100, Math.max(0, raw.fit))) : 0
  const location = textOf(raw.location) ?? ''
  const country = (textOf(raw.country) ?? '').toUpperCase().slice(0, 3)

  return {
    id: urlKeyOf(url),
    company,
    title,
    url,
    location,
    country,
    sponsor: raw.sponsor === true,
    remote: typeof raw.remote === 'boolean' ? raw.remote : isRemoteAbroad(country, location),
    salary: textOf(raw.salary),
    posted: isDay(raw.posted) ? raw.posted : null,
    fit,
    why: textOf(raw.why),
    found_ms: typeof raw.found_ms === 'number' ? raw.found_ms : now,
  }
}

export function jsonTextOf(value: Tracker | Leads): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export function isActive(app: Application): boolean {
  return FUNNEL.includes(app.stage)
}

export function lastDayOf(app: Application): string | null {
  return app.history.at(-1)?.on ?? null
}

export function isSilent(app: Application, now: number): boolean {
  const last = lastDayOf(app)

  return isActive(app) && app.stage !== 'offer' && last !== null && daysSinceOf(last, now) >= SILENCE_DAYS
}

export function nextStageOf(stage: Stage): Stage | undefined {
  const index = FUNNEL.indexOf(stage)

  return index >= 0 && index < FUNNEL.length - 1 ? FUNNEL[index + 1] : undefined
}

export function funnelOf(apps: readonly Application[]): { stage: Stage; count: number }[] {
  const isReached = (app: Application, stage: Stage) => {
    const rank = FUNNEL.indexOf(stage)

    return [app.stage, ...app.history.map(step => step.stage)].some(seen => FUNNEL.indexOf(seen) >= rank)
  }

  return FUNNEL.map(stage => ({ stage, count: apps.filter(app => isReached(app, stage)).length }))
}

export function sortedApplicationsOf(apps: readonly Application[]): Application[] {
  const rank = (app: Application) => (isActive(app) ? FUNNEL.indexOf(app.stage) : -1)

  return [...apps].sort((a, b) => rank(b) - rank(a) || (lastDayOf(b) ?? '').localeCompare(lastDayOf(a) ?? ''))
}

export function rowRefsOf(sorted: readonly Application[], leads: readonly Lead[]): string[] {
  return [...sorted.filter(isActive).map(app => `app:${app.id}`), ...leads.map(lead => `lead:${lead.id}`)]
}

export function rowCommandOf(args: string, refs: readonly string[]): { act: string; id: string } | { error: string } {
  const [act = '', row = '', ...rest] = args.split(/\s+/)
  const kinds = ROW_KINDS[act]
  if (!kinds || rest.length > 0 || !/^\d+$/.test(row)) {
    return { error: USAGE }
  }
  const id = refs[Number(row) - 1]
  if (!id) {
    return { error: `no row ${row}` }
  }
  const kind = id.slice(0, id.indexOf(':'))
  if (!kinds.includes(kind)) {
    return { error: `row ${row} is ${kind === 'app' ? 'an application' : 'a job'}, ${act} works on ${kind === 'app' ? 'jobs' : 'applications'}` }
  }

  return { act, id }
}

export function logApplication(tracker: Tracker, input: ApplicationInput, today: string): Change {
  const url = textOf(input.url)
  const key = url ? urlKeyOf(url) : null
  const id = idOf(`${input.company} ${input.role}`)
  const existing = tracker.applications.find(app => app.id === id || (key !== null && app.url !== null && urlKeyOf(app.url) === key))
  const application: Application = existing
    ? {
        ...existing,
        url: existing.url ?? url,
        resume: textOf(input.resume) ?? existing.resume,
        note: textOf(input.note) ?? existing.note,
      }
    : {
        id,
        company: input.company.trim(),
        role: input.role.trim(),
        url,
        resume: textOf(input.resume),
        stage: 'applied',
        history: [{ stage: 'applied', on: isDay(input.on) ? input.on : today }],
        note: textOf(input.note),
      }
  const applications = existing
    ? tracker.applications.map(app => (app === existing ? application : app))
    : [...tracker.applications, application]

  return { tracker: { ...tracker, applications }, application }
}

export function setStage(
  tracker: Tracker,
  ref: string,
  stage: Stage,
  on: string,
  note?: string | null,
): Change | { error: string } {
  const matches = applicationsOf(tracker, ref)
  const [found] = matches
  if (!found) {
    return { error: `no application "${ref}"` }
  }
  if (matches.length > 1) {
    return { error: `"${ref}" is ambiguous: ${matches.map(app => app.id).join(', ')}` }
  }
  const application: Application = {
    ...found,
    stage,
    history: found.stage === stage ? found.history : [...found.history, { stage, on }],
    note: textOf(note) ?? found.note,
  }

  return {
    tracker: { ...tracker, applications: tracker.applications.map(app => (app === found ? application : app)) },
    application,
  }
}

export function hideLead(tracker: Tracker, id: string): Tracker {
  return tracker.hidden.includes(id) ? tracker : { ...tracker, hidden: [...tracker.hidden, id] }
}

export function visibleLeadsOf(leads: Leads, tracker: Tracker): Lead[] {
  const hidden = new Set(tracker.hidden)
  const applied = new Set(tracker.applications.flatMap(app => (app.url ? [app.id, urlKeyOf(app.url)] : [app.id])))

  return leads.leads
    .filter(lead => !hidden.has(lead.id) && !applied.has(lead.id) && !applied.has(idOf(`${lead.company} ${lead.title}`)))
    .sort((a, b) => Number(a.remote) - Number(b.remote) || b.fit - a.fit || (b.posted ?? '').localeCompare(a.posted ?? ''))
}

export function mergeLeads(
  current: Leads,
  incoming: readonly unknown[],
  query: string | null,
  now: number,
): { leads: Leads; added: number; updated: number; skipped: number } {
  const known = new Map(current.leads.map(lead => [lead.id, lead]))
  const fresh = new Map<string, Lead>()
  let skipped = 0

  for (const value of incoming) {
    const lead = leadOf(value, now)
    if (!lead) {
      skipped += 1
      continue
    }
    fresh.set(lead.id, { ...lead, found_ms: known.get(lead.id)?.found_ms ?? fresh.get(lead.id)?.found_ms ?? now })
  }

  const kept = current.leads.filter(lead => !fresh.has(lead.id) && now - lead.found_ms < LEAD_TTL_MS)
  const added = [...fresh.keys()].filter(id => !known.has(id)).length

  return {
    leads: { v: 1, scanned_ms: now, query: query ?? current.query, leads: [...fresh.values(), ...kept] },
    added,
    updated: fresh.size - added,
    skipped,
  }
}

export function profileOf(text: string): Profile | null {
  const lines = text.split('\n').map(line => line.trim())
  const [name, title, contacts] = lines.filter(Boolean)
  if (!name || !title) {
    return null
  }
  const start = lines.findIndex(line => SKILLS_HEAD.test(line))
  const end = lines.findIndex((line, index) => index > start && SECTION_HEAD.test(line))
  const block = start < 0 ? [] : lines.slice(start + 1, end > start ? end : undefined)
  const skills = block
    .filter(line => line.indexOf(':') > 0)
    .slice(0, SKILL_ROWS)
    .flatMap(line => line.slice(line.indexOf(':') + 1).split(','))
    .map(item => item.replace(/\(.*?\)/g, '').trim())
    .filter(item => /^[A-Z]/.test(item))
    .map(item => SHORT_SKILL[item] ?? item)
  const english = /English \(([A-C][12])\)/.exec(text)?.[1]

  return {
    name,
    title,
    place: contacts?.split(CONTACT_SEPARATOR)[0]?.trim() || null,
    skills: [...new Set(skills)],
    english: english ? `EN ${english}` : null,
  }
}

export function variantsOf(files: readonly FileEntry[], apps: readonly Application[]): Variant[] {
  const groups = new Map<string, { name: string; dir: string; files: FileEntry[] }>()

  for (const file of files) {
    const match = RESUME_FILE.exec(file.name)
    if (!match || (file.dir !== '' && match[1])) {
      continue
    }
    const name = file.dir === '' ? (match[1] ?? 'base') : file.dir
    const group = groups.get(name) ?? { name, dir: file.dir, files: [] }
    group.files.push(file)
    groups.set(name, group)
  }

  for (const file of files) {
    const group = file.dir === '' ? groups.get('base') : groups.get(file.dir)
    if (PDF_FILE.test(file.name) && group && group.dir === file.dir) {
      group.files.push(file)
    }
  }

  const sentOf = (keys: string[]) =>
    apps.filter(app => app.resume !== null && keys.includes(app.resume.replace(/\/+$/, '').toLowerCase())).length

  return [...groups.values()]
    .map(group => {
      const formats = [...new Set(group.files.map(file => file.name.split('.').pop()?.toLowerCase() ?? ''))].sort(
        (a, b) => FORMAT_ORDER.indexOf(a) - FORMAT_ORDER.indexOf(b),
      )
      const own = group.files.filter(file => RESUME_FILE.test(file.name))
      const main = own.find(file => file.name.endsWith('.txt')) ?? own[0]
      const path = group.dir === '' ? (main?.name ?? '') : `${group.dir}/`

      return {
        name: group.name,
        path,
        formats,
        updated_ms: Math.max(0, ...group.files.map(file => file.mtime_ms)),
        sent: sentOf([group.name.toLowerCase(), path.replace(/\/+$/, '').toLowerCase()]),
      }
    })
    .sort((a, b) => (a.name === 'base' ? -1 : b.name === 'base' ? 1 : b.updated_ms - a.updated_ms))
}

export function patternOf(variants: readonly Variant[]): string | null {
  return variants.filter(variant => variant.path.endsWith('/')).sort((a, b) => b.updated_ms - a.updated_ms)[0]?.path ?? null
}

export function tailoredOf(lead: Lead, variants: readonly Variant[]): string | null {
  const folder = `${idOf(lead.company)}/`

  return variants.find(variant => variant.path === folder || variant.path.startsWith(`${idOf(lead.company)}-`))?.path ?? null
}

export function scanPromptOf(config: Config, tracker: Tracker): string {
  const applied = [...new Set(tracker.applications.map(app => app.company))]
  const facts = config.facts ? `, verified facts about me are in ${config.facts}` : ''

  return [
    `Find jobs I should apply to: ${config.target}.`,
    `The resume is resume.txt${facts}. Search the web with the tools you have and the public ATS APIs (Greenhouse, Lever, Ashby); open every posting and make sure it still accepts applications.`,
    `Look for two kinds of jobs, up to ${SCAN_PER_KIND} of each: jobs with a visa, sponsorship or relocation, and fully remote jobs I can do from my country of residence (the resume location) — worldwide, a region that includes my country, or as a contractor or B2B. The employer does not need an entity or payroll in my country: any contract form counts.`,
    ...(config.exclude ? [`Skip ${config.exclude}.`] : []),
    'sponsor=true only when the posting explicitly mentions a visa, sponsorship or relocation.',
    'remote=true only when the posting lets me work from my country without moving; remote limited to a country or region I do not live in, or to holders of a work permit I do not have (such as remote EU or remote UK), is remote=false.',
    `Already applied to: ${applied.length > 0 ? applied.join(', ') : 'nowhere yet'} — do not suggest these companies.`,
    'fit 0–100 is how well the job matches the resume (stack, level, domain); why says briefly why and what is missing, in English.',
    `Save the result with a single mcp__job-hunt__save_leads call, at most ${2 * SCAN_PER_KIND} jobs; reply in chat with a short summary.`,
  ].join('\n')
}

export function tailorPromptOf(lead: Lead, pattern: string | null, facts: string): string {
  const folder = `${idOf(lead.company)}/`
  const source = facts ? `the resume and ${facts}` : 'the resume'

  return [
    `Tailor the resume for ${lead.company} — ${lead.title}: ${lead.url}`,
    pattern
      ? `Read the whole posting and create the folder ${folder} following ${pattern}: resume.html, resume.txt, build.sh, a PDF of exactly one A4 page.`
      : `Read the whole posting and create the folder ${folder}: resume.html, resume.txt and a PDF of exactly one A4 page.`,
    `Only verified facts from ${source}: mirror the wording of the posting where it is true, never add experience that does not exist.`,
    'At the end, list the requirements of the posting that the resume does not cover. Do not log the application — the panel button does that.',
  ].join('\n')
}

function applicationsOf(tracker: Tracker, ref: string): Application[] {
  const key = idOf(ref)
  const exact = tracker.applications.filter(app => app.id === ref || app.id === key)

  return exact.length > 0
    ? exact
    : tracker.applications.filter(app => idOf(app.company) === key || app.id.startsWith(`${key}-`))
}

function applicationOf(value: unknown): Application | undefined {
  const raw = recordOf(value)
  const company = textOf(raw?.company)
  if (!raw || !company) {
    return undefined
  }
  const role = textOf(raw.role) ?? ''
  const history = arrayOf(raw.history)
    .map(recordOf)
    .filter((step): step is Record<string, unknown> => step !== undefined)
    .filter(step => isStage(step.stage) && isDay(step.on))
    .map(step => ({ stage: step.stage as Stage, on: step.on as string }))

  return {
    id: textOf(raw.id) ?? idOf(`${company} ${role}`),
    company,
    role,
    url: textOf(raw.url),
    resume: textOf(raw.resume),
    stage: isStage(raw.stage) ? raw.stage : (history.at(-1)?.stage ?? 'applied'),
    history,
    note: textOf(raw.note),
  }
}

function isRemoteAbroad(country: string, location: string): boolean {
  return REMOTE_REGIONS.has(country) && REMOTE_PLACE.test(location)
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function textOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
