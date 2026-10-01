import type { CommandRunInput, On, RenderPropsOf } from 'claude-code'
import { describe, expect, mock, test, tier, type Engine, type Mounted } from 'claude-code/testing'

tier('user')

const NOW = Date.parse('2026-09-24T12:00:00Z')
const DAY = 86_400_000
const HOME = '/Users/u'
const ROOT = `${HOME}/job-search`
const TRACKER = `${ROOT}/hunt/applications.json`
const LEADS = `${ROOT}/hunt/leads.json`
const PANEL_KEY = 'job-hunt:panel'
const GEKKO = 'https://jobs.example.com/gekko/jobs/6635595'
const GEKKO_ID = 'jobs.example.com/gekko/jobs/6635595'

const SESSION = { surface: 'terminal', isInteractive: true, cwd: ROOT } as const

const command = (args: string): CommandRunInput => ({
  command: 'hunt',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: true, columns: 200 },
})

const paneProps = (placement: 'dock' | 'inline'): RenderPropsOf['Pane'] => ({
  title: 'job-hunt',
  isFocused: false,
  bodyColumns: 44,
  placement,
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
})

const RESUME = [
  'Sam Rivera',
  '',
  'Backend Software Engineer — Go',
  'Porto, Portugal · a@b.c',
  'TECHNICAL SKILLS',
  'Languages: Go (primary), SQL',
  'Data & Messaging: PostgreSQL, Redis, Apache Kafka, ClickHouse',
  'Infrastructure: Kubernetes',
  'EXPERIENCE',
  'Languages: Russian (native), English (C1).',
].join('\n')

const trackerText = (applied = '2026-09-22') =>
  JSON.stringify({
    v: 1,
    applications: [
      {
        id: 'nakatomi-backend',
        company: 'Nakatomi',
        role: 'Backend Developer — Core',
        url: null,
        resume: 'nakatomi-core/',
        stage: 'applied',
        history: [{ stage: 'applied', on: applied }],
        note: null,
      },
      {
        id: 'oscorp-se',
        company: 'Oscorp',
        role: 'Software Engineer – Golang',
        url: null,
        resume: 'resume.txt',
        stage: 'closed',
        history: [
          { stage: 'applied', on: '2026-06-19' },
          { stage: 'closed', on: '2026-09-13' },
        ],
        note: 'not a target',
      },
    ],
    hidden: [],
  })

const leadsText = () =>
  JSON.stringify({
    v: 1,
    scanned_ms: NOW - 3 * 3_600_000,
    query: 'gh',
    leads: [
      {
        id: GEKKO_ID,
        company: 'Gekko',
        title: 'Backend Engineer III',
        url: GEKKO,
        location: 'Cardiff, London',
        country: 'UK',
        sponsor: true,
        salary: '£85–110k',
        posted: '2026-09-14',
        fit: 82,
        why: 'Go, sponsors visas; no AWS',
        found_ms: NOW - DAY,
      },
    ],
  })

const REKALL = 'https://jobs.example.com/rekall/jobs/5146709'

const leadsWithRemote = () => {
  const leads = JSON.parse(leadsText())
  leads.leads.push({ company: 'Rekall', title: 'Golang Engineer', url: REKALL, location: 'Home based - Worldwide', country: 'WW', fit: 90, found_ms: NOW - DAY })

  return JSON.stringify(leads)
}

type Files = Record<string, string>

function world(on: On, files: Files) {
  const opened: { id: string; isFocused: boolean }[] = []
  const tools: string[] = []
  const submitted: string[] = []
  const processes: string[][] = []
  const writes: string[] = []
  const toasts: string[] = []

  mock.env(on, { HOME })
  const clock = mock.clock(on, { now: NOW })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('tool.register', ($, e) => {
    tools.push(e.name)

    return { value: { tool: `mcp__job-hunt__${e.name}` } }
  })
  on('ui.open', ($, e) => {
    opened.push({ id: e.id, isFocused: e.focus === true })

    return { value: { isPlaced: true as const } }
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('ui.toast', ($, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })
  on('process.run', ($, e) => {
    processes.push([...e.argv])
    if (e.argv[0] === 'xdg-open') {
      throw new Error('spawn xdg-open ENOENT')
    }

    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', ($, e) => ({ value: e.path in files }))
  on('fs.read', ($, e) => {
    const text = files[e.path]
    if (text === undefined) {
      throw new Error(`ENOENT: ${e.path}`)
    }

    return { value: text }
  })
  on('fs.write', ($, e) => {
    files[e.path] = e.text
    writes.push(e.path)

    return { value: undefined }
  })
  on('fs.stat', ($, e) => {
    if (!(e.path in files)) {
      throw new Error(`ENOENT: ${e.path}`)
    }

    return { value: { kind: 'file' as const, size: 1, mtimeMs: e.path.includes('nakatomi') ? NOW - 2 * DAY : NOW - 20 * DAY, isLink: false } }
  })
  on('fs.list', ($, e) => {
    const prefix = `${e.path}/`
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of Object.keys(files)) {
      if (path.startsWith(prefix)) {
        const [head, ...rest] = path.slice(prefix.length).split('/')
        if (head) {
          names.set(head, rest.length > 0 ? 'dir' : 'file')
        }
      }
    }

    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 1, isLink: false, mtimeMs: 0 })) }
  })

  return { clock, opened, tools, submitted, processes, writes, toasts }
}

function filesOf(over: Files = {}): Files {
  return {
    [`${ROOT}/resume.txt`]: RESUME,
    [`${ROOT}/Sam-Rivera-Backend-Engineer.pdf`]: '%PDF',
    [`${ROOT}/cover-letter.md`]: 'hi',
    [`${ROOT}/nakatomi-core/resume.html`]: '<html>',
    [`${ROOT}/nakatomi-core/Sam-Rivera-Backend-Engineer-Go.pdf`]: '%PDF',
    [TRACKER]: trackerText(),
    [LEADS]: leadsText(),
    ...over,
  }
}

async function started($: Engine, on: On, files: Files = filesOf()) {
  const setup = world(on, files)
  await $.session.start(SESSION)
  await setup.clock.settle()

  return { ...setup, files }
}

async function mountPanel($: Engine, placement: 'dock' | 'inline' = 'dock') {
  const ui = await $.ui.mount({
    plugin: 'job-hunt',
    surface: 'terminal',
    component: 'Pane',
    props: paneProps(placement),
    requestId: 'job-hunt',
    viewport: { columns: 200, rows: 60, isFullscreen: true },
  })
  await ui.resize({ columns: 44, rows: 60, in: PANEL_KEY })

  return ui
}

async function textOf(ui: Pick<Mounted, 'findAll'>): Promise<string> {
  const texts = await ui.findAll({ type: 'Text', in: PANEL_KEY })
  const buttons = await ui.findAll({ type: 'Button', in: PANEL_KEY })

  return [...texts, ...buttons].map(found => found.text).join('|')
}

describe('register', () => {
  test('a session in job-search opens the panel and registers the tools', async ($, on) => {
    const { opened, tools } = await started($, on)

    expect(opened).toEqual([{ id: 'job-hunt', isFocused: false }])
    expect(tools).toEqual(['save_leads', 'log_application', 'set_stage'])
  })

  test('without resume.txt there are no tools, the panel stays closed and says what it waits for', async ($, on) => {
    const { tools, opened } = await started($, on, {})

    expect(tools).toEqual([])
    expect(opened).toEqual([])
    expect(await textOf(await mountPanel($))).toContain('resume.txt not found')
  })

  test(
    'options set the search target, exclusions and the facts file',
    { options: { target: 'Rust, Berlin', exclude: 'frontend', facts: 'facts.md' } },
    async ($, on) => {
      const { submitted, clock } = await started($, on)
      await $.command.run(command('scan'))
      await clock.settle()

      expect(submitted[0]).toContain('Find jobs I should apply to: Rust, Berlin.')
      expect(submitted[0]).toContain('verified facts about me are in facts.md')
      expect(submitted[0]).toContain('Skip frontend.')
    },
  )

  test('the dock shows resumes, funnel, applications and jobs', async ($, on) => {
    await started($, on)
    const drawn = await textOf(await mountPanel($))

    expect(drawn).toContain('RESUME')
    expect(drawn).toContain('Backend Software Engineer — Go')
    expect(drawn).toContain('nakatomi-core')
    expect(drawn).toContain('html pdf')
    expect(drawn).toContain('Go SQL PG Redis Kafka CH k8s · EN C1')
    expect(drawn).toContain('1 active · 1 closed')
    expect(drawn).toContain('Nakatomi')
    expect(drawn).toContain('applied 2d')
    expect(drawn).toContain(' Oscorp')
    expect(drawn).toContain('JOBS')
    expect(drawn).toContain('scanned 3h ago')
    expect(drawn).toContain('Gekko')
    expect(drawn).toContain('search')
  })

  test('jobs are one list by fit with remote ones marked, row numbers follow it', async ($, on) => {
    const { processes, clock } = await started($, on, filesOf({ [LEADS]: leadsWithRemote() }))
    const drawn = await textOf(await mountPanel($))

    expect(drawn).not.toContain('RELOCATE')
    expect(drawn).not.toContain('REMOTE')
    expect(drawn).toContain('⌂')
    expect(drawn.indexOf('Rekall')).toBeLessThan(drawn.indexOf('Gekko'))

    await $.command.run(command('open 2'))
    await clock.settle()
    expect(processes).toEqual([['xdg-open', REKALL], ['open', REKALL]])
  })

  test('relocate first splits jobs into RELOCATE and REMOTE, row numbers follow the groups', { options: { layout: 'relocate first' } }, async ($, on) => {
    const { processes, clock } = await started($, on, filesOf({ [LEADS]: leadsWithRemote() }))
    const drawn = await textOf(await mountPanel($))

    expect(drawn).toContain('RELOCATE|  1 · visa or move')
    expect(drawn).toContain('REMOTE|  1 · from home')
    expect(drawn).not.toContain('⌂')
    expect(drawn.indexOf('Gekko')).toBeLessThan(drawn.indexOf('Rekall'))

    await $.command.run(command('open 3'))
    await clock.settle()
    expect(processes).toEqual([['xdg-open', REKALL], ['open', REKALL]])
  })

  test('remote first puts the REMOTE group on top', { options: { layout: 'remote first' } }, async ($, on) => {
    await started($, on, filesOf({ [LEADS]: leadsWithRemote() }))
    const drawn = await textOf(await mountPanel($))

    expect(drawn.indexOf('REMOTE')).toBeLessThan(drawn.indexOf('RELOCATE'))
    expect(drawn.indexOf('Rekall')).toBeLessThan(drawn.indexOf('Gekko'))
  })

  test('above the prompt (inline) the resume is not drawn', async ($, on) => {
    await started($, on)
    const drawn = await textOf(await mountPanel($, 'inline'))

    expect(drawn).not.toContain('RESUME')
    expect(drawn).toContain('Gekko')
  })

  test('an application with no movement for 21+ days is flagged silent', async ($, on) => {
    await started($, on, filesOf({ [TRACKER]: trackerText('2026-08-30') }))
    const drawn = await textOf(await mountPanel($))

    expect(drawn).toContain('⚑ 1 silent')
    expect(drawn).toContain('⚑ 25d')
  })

  test('a selected job shows the salary range and the fit reason', async ($, on) => {
    await started($, on)
    const ui = await mountPanel($)
    await ui.press({ key: `hunt:lead:${GEKKO_ID}` })
    const drawn = await textOf(ui)

    expect(drawn).toContain('fit 82 · £85–110k · Cardiff, London ·')
    expect(drawn).toContain('14.09')
    expect(drawn).toContain('no AWS')
    expect(drawn).toContain('tailor')
  })

  test('a logs the application and moves the job to APPLIED', async ($, on) => {
    const { files } = await started($, on)
    const ui = await mountPanel($)
    await ui.press({ key: `hunt:lead:${GEKKO_ID}` })
    await ui.press({ key: 'hunt:apply' })

    const saved = JSON.parse(files[TRACKER] ?? '{}')
    expect(saved.applications.at(-1)).toMatchObject({
      company: 'Gekko',
      role: 'Backend Engineer III',
      url: GEKKO,
      stage: 'applied',
      history: [{ stage: 'applied', on: '2026-09-24' }],
    })
    expect(await textOf(ui)).toContain('2 active')
    expect(await textOf(ui)).toContain('JOBS|  0 · scanned 3h ago')
  })

  test('x hides the job and leaves the jobs file alone', async ($, on) => {
    const { files, writes } = await started($, on)
    const ui = await mountPanel($)
    await ui.press({ key: `hunt:lead:${GEKKO_ID}` })
    await ui.press({ key: 'hunt:hide' })

    expect(JSON.parse(files[TRACKER] ?? '{}').hidden).toEqual([GEKKO_ID])
    expect(writes).not.toContain(LEADS)
    expect(await textOf(ui)).not.toContain('Gekko')
  })

  test('t queues a Claude turn that tailors after the latest folder', async ($, on) => {
    const { submitted } = await started($, on)
    const ui = await mountPanel($)
    await ui.press({ key: `hunt:lead:${GEKKO_ID}` })
    await ui.press({ key: 'hunt:tailor' })

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain(`Tailor the resume for Gekko — Backend Engineer III: ${GEKKO}`)
    expect(submitted[0]).toContain('folder gekko/ following nakatomi-core/')
    expect(submitted[0]).toContain('Only verified facts from the resume and CLAUDE.local.md')
    expect(await textOf(ui)).toContain('Claude is tailoring the resume for Gekko')
  })

  test('s queues one search until the first one finishes', async ($, on) => {
    const { submitted } = await started($, on)
    const ui = await mountPanel($)
    await ui.press({ key: 'hunt:scan' })
    await ui.press({ key: 'hunt:scan' })

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain('Already applied to: Nakatomi, Oscorp')
    expect(await textOf(ui)).toContain('Claude is searching for jobs')
  })

  test('/hunt scan queues a search, /hunt opens the panel focused', async ($, on) => {
    const { submitted, opened, clock } = await started($, on)

    await $.command.run(command('scan'))
    await clock.settle()
    expect(submitted).toHaveLength(1)

    await $.command.run(command(''))
    await clock.settle()
    expect(opened.at(-1)).toEqual({ id: 'job-hunt', isFocused: true })
  })

  test('save_leads merges the scan into leads.json and stops the search spinner', async ($, on) => {
    const { files, clock } = await started($, on)
    const ui = await mountPanel($)
    await ui.press({ key: 'hunt:scan' })
    await clock.advance(60_000)

    const result = await $.tool.call({
      tool: 'mcp__job-hunt__save_leads',
      query: 'greenhouse + ashby',
      leads: [
        { company: 'Spacely', title: 'Senior Go Engineer', url: 'https://jobs.example.com/spacely/1', country: 'DE', sponsor: true, fit: 74 },
        { company: 'no link', title: 'x', fit: 10 },
      ],
    })

    expect('result' in result ? String(result.result) : '').toContain('+1 new, 0 updated, 1 skipped')
    expect(JSON.parse(files[LEADS] ?? '{}').leads.map((item: { company: string }) => item.company)).toEqual(['Spacely', 'Gekko'])
    const drawn = await textOf(ui)
    expect(drawn).toContain('Spacely')
    expect(drawn).not.toContain('Claude is searching for jobs')
  })

  test('log_application and set_stage move an application through the funnel', async ($, on) => {
    const { files } = await started($, on)

    await $.tool.call({ tool: 'mcp__job-hunt__log_application', company: 'Bluth', role: 'Backend Engineer', on: '2026-09-13' })
    const moved = await $.tool.call({ tool: 'mcp__job-hunt__set_stage', ref: 'bluth', stage: 'screen' })

    expect('result' in moved ? String(moved.result) : '').toBe('bluth-backend-engineer → screen')
    expect(JSON.parse(files[TRACKER] ?? '{}').applications.at(-1).history).toEqual([
      { stage: 'applied', on: '2026-09-13' },
      { stage: 'screen', on: '2026-09-24' },
    ])
  })

  test('the mod does not overwrite a broken applications.json', async ($, on) => {
    const { files, writes } = await started($, on, filesOf({ [TRACKER]: '{oops' }))
    const result = await $.tool.call({ tool: 'mcp__job-hunt__log_application', company: 'Bluth', role: 'Backend' })

    expect('deny' in result ? result.deny : '').toContain('not valid JSON')
    expect(writes).toEqual([])
    expect(files[TRACKER]).toBe('{oops')
  })

  test('n moves the selected application to the next stage', async ($, on) => {
    const { files } = await started($, on)
    const ui = await mountPanel($)
    await ui.press({ key: 'hunt:app:nakatomi-backend' })
    await ui.press({ key: 'hunt:next' })

    expect(JSON.parse(files[TRACKER] ?? '{}').applications[0].stage).toBe('screen')
    expect(await textOf(ui)).toContain('screen 0d')
  })

  test('o opens the job in the browser, falling back from xdg-open to open', async ($, on) => {
    const { processes } = await started($, on)
    const ui = await mountPanel($)
    await ui.press({ key: `hunt:lead:${GEKKO_ID}` })
    await ui.press({ key: 'hunt:open-lead' })

    expect(processes).toEqual([['xdg-open', GEKKO], ['open', GEKKO]])
  })

  test('/hunt anon swaps real data for demo data and back', async ($, on) => {
    const { opened, toasts, clock } = await started($, on)
    const ui = await mountPanel($)

    await $.command.run(command('anon'))
    await clock.settle()
    const demo = await textOf(ui)
    for (const real of ['Nakatomi', 'Oscorp', 'Gekko', 'nakatomi-core']) {
      expect(demo).not.toContain(real)
    }
    expect(demo).toContain('Hooli')
    expect(demo).toContain('Vandelay')
    expect(demo).toContain('5 active · 2 closed')
    expect(demo).toContain('⚑ 1 silent')
    expect(opened.at(-1)).toEqual({ id: 'job-hunt', isFocused: true })
    expect(toasts.at(-1)).toContain('demo data on')

    await $.command.run(command('anon'))
    expect(await textOf(ui)).toContain('Nakatomi')
    expect(await textOf(ui)).not.toContain('Hooli')
  })

  test('p in the panel turns on demo data where actions touch nothing', async ($, on) => {
    const { submitted, writes, toasts } = await started($, on)
    const ui = await mountPanel($)

    await ui.key({ key: 'p', in: PANEL_KEY })
    expect(await textOf(ui)).toContain('Hooli')

    await ui.press({ key: 'hunt:lead:example.com/jobs/vandelay-backend-engineer-logistics' })
    expect(await textOf(ui)).toContain('fit 88 · £80–100k · London, hybrid')
    await ui.press({ key: 'hunt:apply' })
    await ui.press({ key: 'hunt:tailor' })
    await ui.press({ key: 'hunt:scan' })

    expect(writes).toEqual([])
    expect(submitted).toEqual([])
    expect(toasts.at(-1)).toContain('actions are off')

    await ui.key({ key: 'p', in: PANEL_KEY })
    expect(await textOf(ui)).toContain('Gekko')
  })
})
