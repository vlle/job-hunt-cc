import type { EngineInterface, Register } from 'claude-code'

import {
  EMPTY_LEADS,
  EMPTY_TRACKER,
  STAGES,
  STAGE_LABEL,
  hideLead,
  isDay,
  isStage,
  jsonTextOf,
  leadsOf,
  logApplication,
  mergeLeads,
  nextStageOf,
  patternOf,
  profileOf,
  rowCommandOf,
  rowRefsOf,
  scanPromptOf,
  setStage,
  sortedApplicationsOf,
  tailorPromptOf,
  tailoredOf,
  todayOf,
  trackerOf,
  variantsOf,
  visibleLeadsOf,
  type Busy,
  type Change,
  type Config,
  type FileEntry,
  type Leads,
  type PanelProps,
  type Profile,
  type Tracker,
} from './hunt'
import { demoOf } from './demo'

type Pending = { busy: Busy; text: string; turnId: string | null }
type Message = { act: string; id: string | null }
type World = {
  config: Config
  root: string
  now: number
  tracker: Tracker
  leads: Leads
  profile: Profile | null
  files: FileEntry[]
  pending: Pending | null
  isDemo: boolean
  shownKey: string
  invalidate: () => void
}

const PLUGIN = 'job-hunt'
const PANE_ID = 'job-hunt'
const PANEL_KEY = 'job-hunt:panel'
const COMMAND = 'hunt'
const PANE_COLUMNS = 44
const POLL_MS = 3000
const BUSY_LIMIT_MS = 45 * 60_000
const ROOT_MARKER = 'resume.txt'
const TRACKER_PATH = 'hunt/applications.json'
const LEADS_PATH = 'hunt/leads.json'
const SKIPPED_DIRS = new Set(['hunt', 'node_modules'])
const DEFAULT_TARGET =
  'roles that match the resume: abroad with visa sponsorship or relocation, or fully remote from my country'
const DEFAULT_FACTS = 'CLAUDE.local.md'
const URL_OPENERS = [['xdg-open'], ['open'], ['rundll32', 'url.dll,FileProtocolHandler']]
const ACTS = new Set(['scan', 'anon', 'tailor', 'apply', 'hide', 'open', 'next', 'reject', 'close'])
const SCAN_LABEL = 'Claude is searching for jobs'
const DEMO_REFUSAL = 'demo data on: actions are off, /hunt anon brings real data back'

const TOOLS = [
  {
    name: 'save_leads',
    description:
      'Saves found jobs to hunt/leads.json and shows them in the job-hunt panel. Merges with earlier scans by url: a repeated job is updated, jobs older than 30 days drop out. Only real open jobs with a direct link.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'what was searched and where, one line' },
        leads: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              company: { type: 'string' },
              title: { type: 'string', description: 'job title as in the posting' },
              url: { type: 'string', description: 'direct link to the posting (http/https)' },
              location: { type: 'string', description: 'city and work format, as in the posting' },
              country: { type: 'string', description: 'office country code: UK, DE, NL…; EU or WW for remote' },
              sponsor: { type: 'boolean', description: 'the posting explicitly mentions a visa, sponsorship or relocation' },
              remote: {
                type: 'boolean',
                description:
                  'fully remote and workable from the candidate country (the resume location) under any contract form: worldwide, a region that includes it, or as a contractor/B2B; remote limited to a country or region the candidate does not live in, or to holders of a work permit they lack, is false',
              },
              salary: { type: 'string', description: 'salary range, if stated' },
              posted: { type: 'string', description: 'publication date YYYY-MM-DD' },
              fit: { type: 'number', minimum: 0, maximum: 100, description: 'match with the resume' },
              why: { type: 'string', description: 'why this fit and what is missing, in English, up to 90 chars' },
            },
            required: ['company', 'title', 'url', 'fit'],
          },
        },
      },
      required: ['leads'],
    },
  },
  {
    name: 'log_application',
    description:
      'Logs a sent application in hunt/applications.json (stage "applied"). A repeated call for the same company and role or the same url updates the entry instead of duplicating it.',
    inputSchema: {
      type: 'object',
      properties: {
        company: { type: 'string' },
        role: { type: 'string' },
        url: { type: 'string' },
        resume: { type: 'string', description: 'which resume variant was sent: resume.txt or a folder such as acme/' },
        on: { type: 'string', description: 'application date YYYY-MM-DD, today by default' },
        note: { type: 'string', description: 'short note in English' },
      },
      required: ['company', 'role'],
    },
  },
  {
    name: 'set_stage',
    description:
      'Moves an application through the funnel: applied → screen → interview → offer, or rejected / closed. ref is the application id or the company name.',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
        stage: { type: 'string', enum: [...STAGES] },
        on: { type: 'string', description: 'date YYYY-MM-DD, today by default' },
        note: { type: 'string', description: 'short note in English' },
      },
      required: ['ref', 'stage'],
    },
  },
]

export const register: Register = (on, options) => {
  const world: World = {
    config: {
      target: optionOf(options.target, DEFAULT_TARGET),
      exclude: optionOf(options.exclude, ''),
      facts: optionOf(options.facts, DEFAULT_FACTS),
    },
    root: '',
    now: 0,
    tracker: EMPTY_TRACKER,
    leads: EMPTY_LEADS,
    profile: null,
    files: [],
    pending: null,
    isDemo: false,
    shownKey: '',
    invalidate: () => {},
  }

  on('session.start', async ($, e, next) => {
    world.invalidate = () => $.ui.invalidate('ui.render')

    const parents = [e.cwd, e.cwd.replace(/\/[^/]+$/, ''), e.cwd.replace(/(\/[^/]+){2}$/, '')]
    for (const candidate of parents) {
      if (candidate && (await $.fs.exists(`${candidate}/${ROOT_MARKER}`).catch(() => false))) {
        world.root = candidate
        break
      }
    }

    await $.command
      .register({
        name: COMMAND,
        description: 'job-hunt panel: resumes, applications, jobs; row actions by number; anon swaps in demo data',
        argumentHint: '[scan | anon | apply|tailor|hide|open|next|reject|close <row>]',
      })
      .catch(() => undefined)
    if (world.root) {
      await Promise.all(TOOLS.map(tool => $.tool.register(tool).catch(() => undefined)))
    }

    const poll = async () => {
      try {
        await refresh($, world)
      } catch (error) {
        $.ui.log(`job-hunt: polling ${world.root} failed: ${String(error)}`, { to: 'debug' })
      }
      $.clock.after(POLL_MS, () => void poll())
    }
    await poll()
    if (world.root) {
      void showPane($, false)
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e, next) => {
    const args = e.args.trim()
    if (args === 'scan') {
      await refresh($, world)
      $.clock.after(0, () => startBusy($, world, 'scan', SCAN_LABEL, scanPromptOf(world.config, world.tracker)))

      return {}
    }
    if (args === 'anon') {
      toggleDemo($, world)
    }
    if (args === '' || args === 'anon') {
      $.clock.after(0, () => void showPane($, true))

      return {}
    }
    if (world.isDemo) {
      return { text: `job-hunt: ${DEMO_REFUSAL}` }
    }
    const refs = rowRefsOf(sortedApplicationsOf(world.tracker.applications), visibleLeadsOf(world.leads, world.tracker))
    const command = rowCommandOf(args, refs)
    if ('error' in command) {
      return { text: `job-hunt: ${command.error}` }
    }
    $.clock.after(0, () => void dispatch($, world, command))

    return {}
  })

  on('turn.start', ($, e, next) => {
    const pending = world.pending
    if (pending && pending.turnId === null && e.text === pending.text) {
      pending.turnId = e.turnId
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (world.pending && e.agentId === undefined && world.pending.turnId === e.turnId) {
      world.pending = null
      await refresh($, world)
      world.invalidate()
    }

    return result
  })

  on('ui.message', async ($, e, next) => {
    if (e.element !== PANEL_KEY) {
      return next(e)
    }
    const message = messageOf(e.data)
    if (message?.act === 'anon') {
      toggleDemo($, world)
    } else if (message) {
      await dispatch($, world, message)
    }

    return {}
  })

  on('tool.call', { tool: `mcp__${PLUGIN}__save_leads` }, async ($, e) => {
    if (!world.root) {
      return { deny: 'job-hunt: resume.txt not found, nowhere to save' }
    }
    const current = leadsOf(await $.fs.read(`${world.root}/${LEADS_PATH}`).catch(() => ''))
    if (!current) {
      return { deny: `${LEADS_PATH} is not valid JSON — fix the file, the mod will not overwrite it` }
    }
    const incoming = Array.isArray(e.leads) ? e.leads : []
    const query = typeof e.query === 'string' && e.query.trim() !== '' ? e.query.trim() : null
    const merged = mergeLeads(current, incoming, query, await $.clock.now())
    await $.fs.write(`${world.root}/${LEADS_PATH}`, jsonTextOf(merged.leads))
    await refresh($, world)
    const shown = visibleLeadsOf(world.leads, world.tracker).length

    return {
      result: `saved to ${LEADS_PATH}: +${merged.added} new, ${merged.updated} updated, ${merged.skipped} skipped without company/title/url; ${shown} in the panel`,
    }
  })

  on('tool.call', { tool: `mcp__${PLUGIN}__log_application` }, async ($, e) => {
    const company = typeof e.company === 'string' ? e.company.trim() : ''
    const role = typeof e.role === 'string' ? e.role.trim() : ''
    if (!world.root || !company || !role) {
      return { deny: world.root ? 'company and role are required' : 'job-hunt: resume.txt not found' }
    }
    const input = {
      company,
      role,
      url: typeof e.url === 'string' ? e.url : null,
      resume: typeof e.resume === 'string' ? e.resume : null,
      on: typeof e.on === 'string' ? e.on : null,
      note: typeof e.note === 'string' ? e.note : null,
    }
    const outcome = await mutate($, world, (fresh, today) => logApplication(fresh, input, today))

    return typeof outcome === 'string'
      ? { deny: outcome }
      : { result: `logged application ${outcome.id} (${STAGE_LABEL.applied}) in ${TRACKER_PATH}` }
  })

  on('tool.call', { tool: `mcp__${PLUGIN}__set_stage` }, async ($, e) => {
    const ref = typeof e.ref === 'string' ? e.ref.trim() : ''
    const stage = e.stage
    if (!world.root || !ref || !isStage(stage)) {
      return { deny: world.root ? `ref and stage (one of ${STAGES.join(', ')}) are required` : 'job-hunt: resume.txt not found' }
    }
    const note = typeof e.note === 'string' ? e.note : null
    const day = isDay(e.on) ? e.on : null
    const outcome = await mutate($, world, (fresh, today) => setStage(fresh, ref, stage, day ?? today, note))

    return typeof outcome === 'string' ? { deny: outcome } : { result: `${outcome.id} → ${STAGE_LABEL[stage]}` }
  })

  on('ui.render', { component: 'Pane' }, ($, e, next) => {
    if (e.requestId !== PANE_ID || (e.surface !== 'terminal' && e.surface !== 'desktop')) {
      return next(e)
    }

    const { Client } = $.ui.resolve(e)

    return (
      <Client
        key={PANEL_KEY}
        module="./panel.tsx"
        props={panelPropsOf(world, e.props.bodyColumns, e.props.placement === 'dock')}
      />
    )
  })
}

function panelPropsOf(world: World, columns: number, isDocked: boolean): PanelProps {
  if (world.isDemo) {
    return { now: world.now, hasRoot: true, busy: null, columns, isDocked, ...demoOf(world.now) }
  }

  return {
    now: world.now,
    hasRoot: world.root !== '',
    profile: world.profile,
    variants: variantsOf(world.files, world.tracker.applications),
    applications: sortedApplicationsOf(world.tracker.applications),
    leads: visibleLeadsOf(world.leads, world.tracker),
    scanned_ms: world.leads.scanned_ms,
    busy: world.pending?.busy ?? null,
    columns,
    isDocked,
  }
}

async function showPane($: EngineInterface, isAsked: boolean): Promise<void> {
  await $.ui
    .open({ id: PANE_ID, title: 'job-hunt', columns: PANE_COLUMNS, ...(isAsked ? { focus: true } : {}) })
    .catch(() => undefined)
}

async function readFiles($: EngineInterface, root: string): Promise<FileEntry[]> {
  const entries = await $.fs.list(root).catch(() => [])
  const dirs = entries.filter(entry => entry.kind === 'dir' && !entry.name.startsWith('.') && !SKIPPED_DIRS.has(entry.name))
  const nested = await Promise.all(
    dirs.map(async dir => (await $.fs.list(`${root}/${dir.name}`).catch(() => [])).map(entry => ({ ...entry, dir: dir.name }))),
  )
  const candidates = [...entries.map(entry => ({ ...entry, dir: '' })), ...nested.flat()].filter(
    entry => entry.kind === 'file' && /^resume|\.pdf$/i.test(entry.name),
  )

  return Promise.all(
    candidates.map(async entry => {
      const relative = entry.dir ? `${entry.dir}/${entry.name}` : entry.name
      const stat = await $.fs.stat(`${root}/${relative}`).catch(() => undefined)

      return { dir: entry.dir, name: entry.name, mtime_ms: stat?.mtimeMs ?? 0 }
    }),
  )
}

async function refresh($: EngineInterface, world: World): Promise<void> {
  world.now = await $.clock.now()
  const root = world.root
  if (!root) {
    return
  }
  const [trackerText, leadsText, resumeText, files] = await Promise.all([
    $.fs.read(`${root}/${TRACKER_PATH}`).catch(() => ''),
    $.fs.read(`${root}/${LEADS_PATH}`).catch(() => ''),
    $.fs.read(`${root}/${ROOT_MARKER}`).catch(() => ''),
    readFiles($, root),
  ])
  world.tracker = trackerOf(trackerText) ?? world.tracker
  world.leads = leadsOf(leadsText) ?? world.leads
  world.profile = profileOf(resumeText)
  world.files = files

  const pending = world.pending
  const isScanSaved = pending?.busy.kind === 'scan' && (world.leads.scanned_ms ?? 0) > pending.busy.since_ms
  if (pending && (isScanSaved || world.now - pending.busy.since_ms > BUSY_LIMIT_MS)) {
    world.pending = null
  }

  const key = JSON.stringify([
    Math.floor(world.now / 60_000),
    world.tracker,
    world.leads,
    world.profile,
    world.files,
    world.pending?.busy,
  ])
  if (key !== world.shownKey) {
    world.shownKey = key
    world.invalidate()
  }
}

async function mutate(
  $: EngineInterface,
  world: World,
  change: (fresh: Tracker, today: string) => Change | Tracker | { error: string },
): Promise<string | { id: string | null }> {
  const path = `${world.root}/${TRACKER_PATH}`
  const fresh = trackerOf(await $.fs.read(path).catch(() => ''))
  if (!fresh) {
    return `${TRACKER_PATH} is not valid JSON — fix it by hand, the mod will not overwrite it`
  }
  const outcome = change(fresh, todayOf(await $.clock.now()))
  if ('error' in outcome) {
    return outcome.error
  }
  const tracker = 'tracker' in outcome ? outcome.tracker : outcome
  await $.fs.write(path, jsonTextOf(tracker))
  world.tracker = tracker
  await refresh($, world)

  return { id: 'application' in outcome ? outcome.application.id : null }
}

function startBusy($: EngineInterface, world: World, kind: Busy['kind'], label: string, text: string): void {
  if (world.pending) {
    $.ui.toast(`job-hunt: already running: ${world.pending.busy.label}`)

    return
  }
  const entry: Pending = { busy: { kind, label, since_ms: world.now }, text, turnId: null }
  const release = () => {
    if (world.pending === entry) {
      world.pending = null
      world.invalidate()
    }
  }
  world.pending = entry
  world.invalidate()
  void $.prompt
    .submit({ text })
    .then(result => {
      if (result.drop !== undefined) {
        release()
      }
    })
    .catch(release)
}

function toggleDemo($: EngineInterface, world: World): void {
  world.isDemo = !world.isDemo
  world.invalidate()
  $.ui.toast(world.isDemo ? 'job-hunt: demo data on, real data hidden' : 'job-hunt: real data back')
}

async function dispatch($: EngineInterface, world: World, message: Message): Promise<void> {
  const error = await perform($, world, message)
  if (error) {
    $.ui.toast(`job-hunt: ${error}`)
  }
}

async function perform($: EngineInterface, world: World, message: Message): Promise<string | undefined> {
  if (world.isDemo) {
    return DEMO_REFUSAL
  }
  const id = message.id ?? ''
  const lead = world.leads.leads.find(item => item.id === id || `lead:${item.id}` === id)
  const app = world.tracker.applications.find(item => item.id === id || `app:${item.id}` === id)
  const variants = variantsOf(world.files, world.tracker.applications)
  const failed = (outcome: string | { id: string | null }) => (typeof outcome === 'string' ? outcome : undefined)

  switch (message.act) {
    case 'scan':
      startBusy($, world, 'scan', SCAN_LABEL, scanPromptOf(world.config, world.tracker))
      return undefined
    case 'tailor':
      if (lead) {
        const prompt = tailorPromptOf(lead, patternOf(variants), world.config.facts)
        startBusy($, world, 'tailor', `Claude is tailoring the resume for ${lead.company}`, prompt)
      }
      return undefined
    case 'apply': {
      if (!lead) {
        return undefined
      }
      const input = { company: lead.company, role: lead.title, url: lead.url, resume: tailoredOf(lead, variants), note: lead.why }
      return failed(await mutate($, world, (fresh, today) => logApplication(fresh, input, today)))
    }
    case 'hide':
      return lead ? failed(await mutate($, world, fresh => hideLead(fresh, lead.id))) : undefined
    case 'next': {
      const stage = app ? nextStageOf(app.stage) : undefined
      return app && stage ? failed(await mutate($, world, (fresh, today) => setStage(fresh, app.id, stage, today))) : undefined
    }
    case 'reject':
      return app ? failed(await mutate($, world, (fresh, today) => setStage(fresh, app.id, 'rejected', today))) : undefined
    case 'close':
      return app ? failed(await mutate($, world, (fresh, today) => setStage(fresh, app.id, 'closed', today))) : undefined
    case 'open': {
      const url = id.startsWith('app:') ? app?.url : lead?.url
      return url ? openUrl($, url) : undefined
    }
    default:
      return undefined
  }
}

async function openUrl($: EngineInterface, url: string): Promise<string | undefined> {
  for (const opener of URL_OPENERS) {
    const result = await $.process.run([...opener, url], { timeoutMs: 10_000 }).catch(() => undefined)
    if (result?.exitCode === 0) {
      return undefined
    }
  }

  return `could not open ${url}: no xdg-open, open or rundll32 worked`
}

function optionOf(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function messageOf(data: unknown): Message | undefined {
  if (typeof data !== 'object' || data === null) {
    return undefined
  }
  const { act, id } = data as { act?: unknown; id?: unknown }

  return typeof act === 'string' && ACTS.has(act) ? { act, id: typeof id === 'string' ? id : null } : undefined
}
