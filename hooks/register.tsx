import { atom, read, update } from 'claude-code'
import type { EngineInterface, HookFailure, Register } from 'claude-code'

import {
  DEFAULT_LAYOUT,
  EMPTY_FOLDER,
  EMPTY_LEADS,
  EMPTY_TRACKER,
  STAGES,
  STAGE_LABEL,
  hideLead,
  initPromptOf,
  isDay,
  isLayout,
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
  type Folder,
  type Layout,
  type PanelProps,
  type Pending,
  type Tracker,
} from './hunt'
import { demoOf } from './demo'

type Message = { act: string; id: string | null }
type World = { config: Config; cwd: string; isWatching: boolean }
type Shown = { folder: Folder; now: number; busy: Busy | null; isDemo: boolean; layout: Layout }

const PANE_ID = 'job-hunt'
const PANEL_KEY = 'job-hunt:panel'
const PANE_COLUMNS = 44
const POLL_MS = 3000
const MINUTE_MS = 60_000
const BUSY_LIMIT_MS = 45 * 60_000
const ROOT_MARKER = 'resume.txt'
const TRACKER_PATH = 'hunt/applications.json'
const LEADS_PATH = 'hunt/leads.json'
const SKIPPED_DIRS = new Set(['hunt', 'node_modules'])
const DEFAULT_TARGET =
  'roles that match the resume: abroad with visa sponsorship or relocation, or fully remote from my country'
const DEFAULT_FACTS = 'CLAUDE.local.md'
const URL_OPENERS = [['xdg-open'], ['open'], ['rundll32', 'url.dll,FileProtocolHandler']]
const ACTS = new Set(['init', 'scan', 'anon', 'tailor', 'apply', 'hide', 'open', 'next', 'reject', 'close'])
const DEMO_ARGS = new Set(['demo', 'anon'])
const INIT_LABEL = 'Claude is setting up this folder'
const SCAN_LABEL = 'Claude is searching for jobs'
const SCAN_DONE = 'search finished, new jobs are in the panel'
const DEMO_REFUSAL = 'demo data on: actions are off, /hunt demo brings real data back'
const NO_ROOT = 'no resume.txt here yet: /hunt init sets this folder up, /hunt demo shows made-up data'

const FOLDER = atom({ plugin: 'job-hunt', key: 'folder' } as const, EMPTY_FOLDER)
const NOW = atom({ plugin: 'job-hunt', key: 'now' } as const, 0)
const PENDING = atom({ plugin: 'job-hunt', key: 'pending' } as const, null)
const IS_DEMO = atom({ plugin: 'job-hunt', key: 'isDemo' } as const, false)

const TOOLS = [
  {
    name: 'save_leads',
    isDeferred: false,
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
    isDeferred: false,
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
    isDeferred: false,
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
      layout: isLayout(options.layout) ? options.layout : DEFAULT_LAYOUT,
    },
    cwd: '',
    isWatching: false,
  }

  on('session.start', async ($, e, next) => {
    world.cwd = e.cwd
    await $.command
      .register({
        name: 'hunt',
        description: 'job-hunt panel: applications, jobs that fit your resume, tailored resumes; init sets a folder up, demo shows made-up data',
        argumentHint: '[init | demo | scan | apply|tailor|hide|open|next|reject|close <row>]',
      })
      .catch(() => undefined)

    const root = await rootOf($, e.cwd)
    await update($, FOLDER, current => (current.root === root ? current : { ...EMPTY_FOLDER, root }))
    if (root) {
      await registerTools($)
    }

    const poll = async () => {
      try {
        await refresh($, world)
      } catch (error) {
        $.ui.log(`job-hunt: polling ${world.cwd} failed: ${String(error)}`, { to: 'debug' })
      }
      $.clock.after(POLL_MS, () => void poll())
    }
    await poll()
    if (root) {
      void showPane($, false)
    }

    return next(e)
  })

  on('command.run', { command: 'hunt' }, async ($, e) => {
    const args = e.args.trim()
    if (DEMO_ARGS.has(args)) {
      await toggleDemo($)
      await showPane($, true)

      return {}
    }
    if (args === '') {
      world.isWatching = true
      await showPane($, true)

      return {}
    }
    if (args === 'init') {
      const { root } = await read($, FOLDER)
      if (root) {
        return { text: `job-hunt: this folder is set up already, see ${root}/${ROOT_MARKER}` }
      }
      world.isWatching = true
      $.clock.after(0, () => void dispatch($, world, { act: 'init', id: null }))
      await showPane($, true)

      return {}
    }
    if (await read($, IS_DEMO)) {
      return { text: `job-hunt: ${DEMO_REFUSAL}` }
    }
    const folder = await read($, FOLDER)
    if (!folder.root) {
      return { text: `job-hunt: ${NO_ROOT}` }
    }
    if (args === 'scan') {
      $.clock.after(0, () => void dispatch($, world, { act: 'scan', id: null }))

      return {}
    }
    const visible = visibleLeadsOf(folder.leads, folder.tracker, world.config.layout)
    const refs = rowRefsOf(sortedApplicationsOf(folder.tracker.applications), visible)
    const command = rowCommandOf(args, refs)
    if ('error' in command) {
      return { text: `job-hunt: ${command.error}` }
    }
    $.clock.after(0, () => void dispatch($, world, command))

    return {}
  })

  on('turn.start', async ($, e, next) => {
    const entry = await read($, PENDING)
    if (entry && entry.turnId === null && e.agentId === undefined && e.text.includes(entry.text)) {
      await update($, PENDING, current => (current && e.text.includes(current.text) ? { ...current, turnId: e.turnId } : current))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const entry = await read($, PENDING)
    if (entry && e.agentId === undefined && entry.turnId === e.turnId) {
      await settle($, entry, entry.busy.kind === 'tailor')
      await refresh($, world)
    }

    return result
  })

  on('ui.message', async ($, e, next) => {
    if (e.element !== PANEL_KEY) {
      return next(e)
    }
    const message = messageOf(e.data)
    if (message?.act === 'anon') {
      await toggleDemo($)
    } else if (message) {
      await dispatch($, world, message)
    }

    return {}
  })

  on('tool.call', { tool: 'mcp__job-hunt__save_leads' }, async ($, e) => {
    const { root } = await read($, FOLDER)
    if (!root) {
      return { deny: 'job-hunt: resume.txt not found, nowhere to save' }
    }
    const current = leadsOf(await $.fs.read(`${root}/${LEADS_PATH}`).catch(() => ''))
    if (!current) {
      return { deny: `${LEADS_PATH} is not valid JSON — fix the file, the mod will not overwrite it` }
    }
    const incoming = Array.isArray(e.leads) ? e.leads : []
    const query = typeof e.query === 'string' && e.query.trim() !== '' ? e.query.trim() : null
    const merged = mergeLeads(current, incoming, query, await $.clock.now())
    await $.fs.write(`${root}/${LEADS_PATH}`, jsonTextOf(merged.leads))
    await refresh($, world)
    const folder = await read($, FOLDER)
    const shown = visibleLeadsOf(folder.leads, folder.tracker, world.config.layout).length

    return {
      result: `saved to ${LEADS_PATH}: +${merged.added} new, ${merged.updated} updated, ${merged.skipped} skipped without company/title/url; ${shown} in the panel`,
    }
  }).catch(($, e, next) => ({ deny: failureOf('save_leads', next.error) }))

  on('tool.call', { tool: 'mcp__job-hunt__log_application' }, async ($, e) => {
    const company = typeof e.company === 'string' ? e.company.trim() : ''
    const role = typeof e.role === 'string' ? e.role.trim() : ''
    const { root } = await read($, FOLDER)
    if (!root || !company || !role) {
      return { deny: root ? 'company and role are required' : 'job-hunt: resume.txt not found' }
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
  }).catch(($, e, next) => ({ deny: failureOf('log_application', next.error) }))

  on('tool.call', { tool: 'mcp__job-hunt__set_stage' }, async ($, e) => {
    const ref = typeof e.ref === 'string' ? e.ref.trim() : ''
    const stage = e.stage
    const { root } = await read($, FOLDER)
    if (!root || !ref || !isStage(stage)) {
      return { deny: root ? `ref and stage (one of ${STAGES.join(', ')}) are required` : 'job-hunt: resume.txt not found' }
    }
    const note = typeof e.note === 'string' ? e.note : null
    const day = isDay(e.on) ? e.on : null
    const outcome = await mutate($, world, (fresh, today) => setStage(fresh, ref, stage, day ?? today, note))

    return typeof outcome === 'string' ? { deny: outcome } : { result: `${outcome.id} → ${STAGE_LABEL[stage]}` }
  }).catch(($, e, next) => ({ deny: failureOf('set_stage', next.error) }))

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      return next(e)
    }

    const { Client } = $.ui.resolve(e)
    const [folder, now, pending, isDemo] = await Promise.all([read($, FOLDER), read($, NOW), read($, PENDING), read($, IS_DEMO)])
    const shown: Shown = { folder, now, busy: pending?.busy ?? null, isDemo, layout: world.config.layout }

    return (
      <Client
        key={PANEL_KEY}
        module="./panel.tsx"
        props={panelPropsOf(shown, e.props.bodyColumns, e.props.placement === 'dock')}
      />
    )
  })
}

function panelPropsOf(shown: Shown, columns: number, isDocked: boolean): PanelProps {
  const { folder, now, layout } = shown
  if (shown.isDemo) {
    const demo = demoOf(now)
    const leads = visibleLeadsOf({ ...EMPTY_LEADS, leads: demo.leads }, EMPTY_TRACKER, layout)

    return { now, hasRoot: true, busy: null, columns, isDocked, layout, ...demo, leads }
  }

  return {
    now,
    hasRoot: folder.root !== '',
    profile: folder.profile,
    variants: variantsOf(folder.files, folder.tracker.applications),
    applications: sortedApplicationsOf(folder.tracker.applications),
    leads: visibleLeadsOf(folder.leads, folder.tracker, layout),
    scanned_ms: folder.leads.scanned_ms,
    layout,
    busy: shown.busy,
    columns,
    isDocked,
  }
}

async function rootOf($: EngineInterface, cwd: string): Promise<string> {
  const candidates = [cwd, cwd.replace(/\/[^/]+$/, ''), cwd.replace(/(\/[^/]+){2}$/, '')]
  for (const candidate of candidates) {
    if (candidate && (await $.fs.exists(`${candidate}/${ROOT_MARKER}`).catch(() => false))) {
      return candidate
    }
  }

  return ''
}

async function registerTools($: EngineInterface): Promise<void> {
  await Promise.all(TOOLS.map(tool => $.tool.register(tool).catch(() => undefined)))
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
  const now = await $.clock.now()
  if (Math.floor((await read($, NOW)) / MINUTE_MS) !== Math.floor(now / MINUTE_MS)) {
    await update($, NOW, () => now)
  }

  const current = await read($, FOLDER)
  const root = current.root || (world.isWatching ? await rootOf($, world.cwd) : '')
  if (!root) {
    return
  }
  if (!current.root) {
    await registerTools($)
  }
  const [trackerText, leadsText, resumeText, files] = await Promise.all([
    $.fs.read(`${root}/${TRACKER_PATH}`).catch(() => ''),
    $.fs.read(`${root}/${LEADS_PATH}`).catch(() => ''),
    $.fs.read(`${root}/${ROOT_MARKER}`).catch(() => ''),
    readFiles($, root),
  ])
  const folder: Folder = {
    root,
    profile: profileOf(resumeText),
    files,
    tracker: trackerOf(trackerText) ?? current.tracker,
    leads: leadsOf(leadsText) ?? current.leads,
  }
  if (JSON.stringify(folder) !== JSON.stringify(current)) {
    await update($, FOLDER, () => folder)
  }

  const entry = await read($, PENDING)
  if (entry?.busy.kind === 'scan' && (folder.leads.scanned_ms ?? 0) > entry.busy.since_ms) {
    await settle($, entry, true)
  } else if (entry && now - entry.busy.since_ms > BUSY_LIMIT_MS) {
    await settle($, entry, false)
  }
}

async function mutate(
  $: EngineInterface,
  world: World,
  change: (fresh: Tracker, today: string) => Change | Tracker | { error: string },
): Promise<string | { id: string | null }> {
  const { root } = await read($, FOLDER)
  const path = `${root}/${TRACKER_PATH}`
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
  await update($, FOLDER, current => ({ ...current, tracker }))
  await refresh($, world)

  return { id: 'application' in outcome ? outcome.application.id : null }
}

async function startBusy($: EngineInterface, busy: Omit<Busy, 'since_ms'>, text: string, done: string | null): Promise<void> {
  const running = await read($, PENDING)
  if (running) {
    $.ui.toast(`job-hunt: already running: ${running.busy.label}`)

    return
  }
  const entry: Pending = { busy: { ...busy, since_ms: await $.clock.now() }, text, turnId: null, done }
  await update($, PENDING, () => entry)
  void $.prompt
    .submit({ text })
    .then(result => {
      if (result.drop !== undefined) {
        void settle($, entry, false)
      }
    })
    .catch(() => void settle($, entry, false))
}

async function settle($: EngineInterface, entry: Pending, isDone: boolean): Promise<void> {
  const current = await read($, PENDING)
  if (current?.text !== entry.text || current.busy.since_ms !== entry.busy.since_ms) {
    return
  }
  await update($, PENDING, () => null)
  if (isDone && entry.done) {
    const sent = await $.ui.notify(entry.done).catch(() => undefined)
    if (!sent?.isSent) {
      $.ui.toast(`job-hunt: ${entry.done}`)
    }
  }
}

async function toggleDemo($: EngineInterface): Promise<void> {
  const isOn = !(await read($, IS_DEMO))
  await update($, IS_DEMO, () => isOn)
  $.ui.toast(isOn ? 'job-hunt: demo data on, real data hidden' : 'job-hunt: real data back')
}

async function dispatch($: EngineInterface, world: World, message: Message): Promise<void> {
  const error = await perform($, world, message)
  if (error) {
    $.ui.toast(`job-hunt: ${error}`)
  }
}

async function perform($: EngineInterface, world: World, message: Message): Promise<string | undefined> {
  if (await read($, IS_DEMO)) {
    return DEMO_REFUSAL
  }
  const folder = await read($, FOLDER)
  if (message.act === 'init') {
    world.isWatching = true
    if (!folder.root) {
      await startBusy($, { kind: 'init', label: INIT_LABEL }, initPromptOf(world.cwd), null)
    }

    return undefined
  }
  if (!folder.root) {
    return NO_ROOT
  }
  const id = message.id ?? ''
  const lead = folder.leads.leads.find(item => item.id === id || `lead:${item.id}` === id)
  const app = folder.tracker.applications.find(item => item.id === id || `app:${item.id}` === id)
  const variants = variantsOf(folder.files, folder.tracker.applications)
  const failed = (outcome: string | { id: string | null }) => (typeof outcome === 'string' ? outcome : undefined)

  switch (message.act) {
    case 'scan':
      await startBusy($, { kind: 'scan', label: SCAN_LABEL }, scanPromptOf(world.config, folder.tracker), SCAN_DONE)
      return undefined
    case 'tailor':
      if (lead) {
        const prompt = tailorPromptOf(lead, patternOf(variants), world.config.facts)
        const done = `the resume for ${lead.company} is tailored`
        await startBusy($, { kind: 'tailor', label: `Claude is tailoring the resume for ${lead.company}` }, prompt, done)
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

function failureOf(tool: string, error: HookFailure): string {
  return `job-hunt: ${tool} failed: ${error.message ?? error.kind}`
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
