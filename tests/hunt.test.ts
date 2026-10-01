import { describe, expect, test, tier } from 'claude-code/testing'

import {
  EMPTY_LEADS,
  EMPTY_TRACKER,
  funnelOf,
  isSilent,
  leadOf,
  logApplication,
  mergeLeads,
  profileOf,
  scanPromptOf,
  setStage,
  tailoredOf,
  trackerOf,
  variantsOf,
  visibleLeadsOf,
  type Application,
  type Config,
  type Layout,
  type Lead,
  type Tracker,
} from '../hooks/hunt'
import { demoOf } from '../hooks/demo'

tier('user')

const NOW = Date.parse('2026-09-24T12:00:00Z')
const DAY = 86_400_000

const RESUME = [
  'Sam Rivera',
  '',
  'Backend Software Engineer — Go',
  'Porto, Portugal · a@b.c · Telegram: @x',
  'TECHNICAL SKILLS',
  'Languages: Go (primary), SQL',
  '',
  'Data & Messaging: PostgreSQL, Redis, Apache Kafka, ClickHouse',
  'Infrastructure: Kubernetes, microservices, CI/CD',
  'Practices: system design, code review',
  'EXPERIENCE',
  'Languages: Russian (native), English (C1).',
].join('\n')

const app = (over: Partial<Application> = {}): Application => ({
  id: 'nakatomi-backend',
  company: 'Nakatomi',
  role: 'Backend',
  url: null,
  resume: 'nakatomi-core/',
  stage: 'applied',
  history: [{ stage: 'applied', on: '2026-09-22' }],
  note: null,
  ...over,
})

const lead = (over: Partial<Lead> = {}): Lead => ({
  id: 'jobs.example.com/gekko/jobs/1',
  company: 'Gekko',
  title: 'Backend Engineer III',
  url: 'https://jobs.example.com/gekko/jobs/1',
  location: 'London',
  country: 'UK',
  sponsor: true,
  remote: false,
  salary: '£85–110k',
  posted: '2026-09-14',
  fit: 80,
  why: null,
  found_ms: NOW,
  ...over,
})

describe('hunt', () => {
  test('an empty file is an empty tracker, broken JSON is undefined so it is never overwritten', () => {
    expect(trackerOf('')).toEqual(EMPTY_TRACKER)
    expect(trackerOf('{oops')).toBeUndefined()
  })

  test('without a stage field the stage comes from the last history step', () => {
    const tracker = trackerOf(
      JSON.stringify({ applications: [{ company: 'Oscorp', role: 'SE', history: [{ stage: 'applied', on: '2026-06-19' }, { stage: 'closed', on: '2026-09-13' }] }] }),
    )

    expect(tracker?.applications[0]?.stage).toBe('closed')
    expect(tracker?.applications[0]?.id).toBe('oscorp-se')
  })

  test('a job without an http link is dropped, fit is clamped to 0–100', () => {
    expect(leadOf({ company: 'A', title: 'B', url: 'ftp://x', fit: 50 }, NOW)).toBeUndefined()
    expect(leadOf({ company: 'A', title: 'B', url: 'https://x.io/j/1?utm=1', fit: 140, country: 'de' }, NOW)).toMatchObject({
      id: 'x.io/j/1',
      fit: 100,
      country: 'DE',
      found_ms: NOW,
    })
  })

  test('remote comes from the posting, an old job without the field is remote when it is WW or EU and remote', () => {
    const job = { company: 'A', title: 'B', url: 'https://x.io/j/1', fit: 50 }

    expect(leadOf({ ...job, remote: true, country: 'DE', location: 'Berlin' }, NOW)?.remote).toBe(true)
    expect(leadOf({ ...job, remote: false, country: 'WW', location: 'Remote, Global' }, NOW)?.remote).toBe(false)
    expect(leadOf({ ...job, country: 'ww', location: 'Remote, Global' }, NOW)?.remote).toBe(true)
    expect(leadOf({ ...job, country: 'EU', location: 'Home based - EMEA' }, NOW)?.remote).toBe(true)
    expect(leadOf({ ...job, country: 'DE', location: 'Germany | Remote' }, NOW)?.remote).toBe(false)
    expect(leadOf({ ...job, country: 'EU', location: 'Amsterdam' }, NOW)?.remote).toBe(false)
  })

  test('the funnel counts how far an application got, even a closed one', () => {
    const apps = [
      app(),
      app({ id: 'b', stage: 'rejected', history: [{ stage: 'applied', on: '2026-09-01' }, { stage: 'screen', on: '2026-09-05' }, { stage: 'rejected', on: '2026-09-10' }] }),
    ]

    expect(funnelOf(apps).map(step => step.count)).toEqual([2, 1, 0, 0])
  })

  test('silence is 21 days without movement, an offer is never silent', () => {
    const old = [{ stage: 'applied' as const, on: '2026-08-30' }]

    expect(isSilent(app({ history: old }), NOW)).toBe(true)
    expect(isSilent(app(), NOW)).toBe(false)
    expect(isSilent(app({ stage: 'offer', history: old }), NOW)).toBe(false)
    expect(isSilent(app({ stage: 'closed', history: old }), NOW)).toBe(false)
  })

  test('a repeated application with the same url updates the entry instead of duplicating it', () => {
    const first = logApplication(EMPTY_TRACKER, { company: 'Gekko', role: 'Backend III', url: 'https://m.io/j/1' }, '2026-09-24')
    const again = logApplication(first.tracker, { company: 'Gekko', role: 'Backend Engineer III', url: 'https://m.io/j/1/', resume: 'gekko/' }, '2026-09-25')

    expect(again.tracker.applications).toHaveLength(1)
    expect(again.application).toMatchObject({ resume: 'gekko/', history: [{ stage: 'applied', on: '2026-09-24' }] })
  })

  test('the stage is set by company name, ambiguity is an error', () => {
    const tracker: Tracker = { v: 1, applications: [app()], hidden: [] }
    const moved = setStage(tracker, 'nakatomi', 'screen', '2026-09-25')

    expect('error' in moved ? moved.error : moved.application.history).toEqual([
      { stage: 'applied', on: '2026-09-22' },
      { stage: 'screen', on: '2026-09-25' },
    ])

    const twice: Tracker = { v: 1, applications: [app(), app({ id: 'nakatomi-other', role: 'Other' })], hidden: [] }
    expect(setStage(twice, 'Nakatomi', 'screen', '2026-09-25')).toMatchObject({ error: expect.stringContaining('ambiguous') })
    expect(setStage(tracker, 'Bluth', 'screen', '2026-09-25')).toMatchObject({ error: expect.stringContaining('no application') })
  })

  test('the panel skips hidden and already applied jobs, best fit first', () => {
    const leads = {
      ...EMPTY_LEADS,
      leads: [
        lead({ id: 'a', url: 'https://a.io', fit: 40 }),
        lead({ id: 'b', url: 'https://b.io', fit: 90 }),
        lead({ id: 'c', url: 'https://c.io', fit: 70 }),
        lead({ id: 'd', url: 'https://d.io', company: 'Nakatomi', title: 'Backend', fit: 99 }),
      ],
    }
    const tracker: Tracker = { v: 1, applications: [app()], hidden: ['c'] }

    expect(visibleLeadsOf(leads, tracker, 'one list').map(item => item.id)).toEqual(['b', 'a'])
  })

  test('one list ranks by fit alone, a grouped layout puts its group on top and ranks each by fit', () => {
    const leads = {
      ...EMPTY_LEADS,
      leads: [
        lead({ id: 'r1', remote: true, fit: 60 }),
        lead({ id: 'm1', fit: 50 }),
        lead({ id: 'r2', remote: true, fit: 95 }),
        lead({ id: 'm2', fit: 80 }),
      ],
    }

    const idsOf = (layout: Layout) => visibleLeadsOf(leads, EMPTY_TRACKER, layout).map(item => item.id)

    expect(idsOf('one list')).toEqual(['r2', 'm2', 'r1', 'm1'])
    expect(idsOf('relocate first')).toEqual(['m2', 'm1', 'r2', 'r1'])
    expect(idsOf('remote first')).toEqual(['r2', 'r1', 'm2', 'm1'])
  })

  test('merging a scan keeps the found date, jobs older than 30 days drop out', () => {
    const current = {
      ...EMPTY_LEADS,
      leads: [lead({ found_ms: NOW - 5 * DAY }), lead({ id: 'x.io/old', url: 'https://x.io/old', found_ms: NOW - 40 * DAY })],
    }
    const merged = mergeLeads(
      current,
      [{ ...lead(), fit: 85 }, { company: 'Spacely', title: 'Go Engineer', url: 'https://spacely.co/j/2', fit: 70 }, { company: 'broken' }],
      'gh+ashby',
      NOW,
    )

    expect(merged).toMatchObject({ added: 1, updated: 1, skipped: 1 })
    expect(merged.leads.leads.map(item => [item.company, item.found_ms, item.fit])).toEqual([
      ['Gekko', NOW - 5 * DAY, 85],
      ['Spacely', NOW, 70],
    ])
    expect(merged.leads).toMatchObject({ scanned_ms: NOW, query: 'gh+ashby' })
  })

  test('the profile from resume.txt: title, city, short stack, English level', () => {
    expect(profileOf(RESUME)).toEqual({
      name: 'Sam Rivera',
      title: 'Backend Software Engineer — Go',
      place: 'Porto, Portugal',
      skills: ['Go', 'SQL', 'PG', 'Redis', 'Kafka', 'CH', 'k8s', 'CI/CD'],
      english: 'EN C1',
    })
  })

  test('the profile reads a plain SKILLS block, any row keys and a pipe between contacts', () => {
    const resume = ['Jo Park', 'Platform Engineer', 'Berlin | jo@park.dev', 'SKILLS', 'Core: Rust, Kubernetes', 'WORK HISTORY', 'Tools: Vim'].join('\n')

    expect(profileOf(resume)).toMatchObject({ place: 'Berlin', skills: ['Rust', 'k8s'], english: null })
  })

  test('resume variants: base with pdf, web versions, company folders and how often each was sent', () => {
    const files = [
      { dir: '', name: 'resume.txt', mtime_ms: NOW - 20 * DAY },
      { dir: '', name: 'resume.html', mtime_ms: NOW - 21 * DAY },
      { dir: '', name: 'Sam-Rivera-Backend-Engineer.pdf', mtime_ms: NOW - 10 * DAY },
      { dir: '', name: 'resume-web-v2.html', mtime_ms: NOW },
      { dir: 'nakatomi-core', name: 'resume.html', mtime_ms: NOW - 2 * DAY },
      { dir: 'nakatomi-core', name: 'Sam-Rivera-Backend-Engineer-Go.pdf', mtime_ms: NOW - 2 * DAY },
      { dir: 'nakatomi-core', name: 'build.sh', mtime_ms: NOW - 2 * DAY },
    ]
    const variants = variantsOf(files, [app(), app({ id: 'oscorp', resume: 'resume.txt' })])

    expect(variants.map(variant => [variant.name, variant.path, variant.formats.join(' '), variant.sent])).toEqual([
      ['base', 'resume.txt', 'txt html pdf', 1],
      ['web-v2', 'resume-web-v2.html', 'html', 0],
      ['nakatomi-core', 'nakatomi-core/', 'html pdf', 1],
    ])
    expect(tailoredOf(lead({ company: 'Nakatomi' }), variants)).toBe('nakatomi-core/')
    expect(tailoredOf(lead(), variants)).toBeNull()
  })

  test('the search prompt carries the target, exclusions, facts file, past applications and the save tool', () => {
    const config: Config = { target: 'Go, UK', exclude: 'frontend and internships', facts: 'facts.md', layout: 'one list' }
    const prompt = scanPromptOf(config, { v: 1, applications: [app()], hidden: [] })

    expect(prompt).toContain('Go, UK')
    expect(prompt).toContain('resume.txt, verified facts about me are in facts.md.')
    expect(prompt).toContain('Skip frontend and internships.')
    expect(prompt).toContain('Already applied to: Nakatomi')
    expect(prompt).toContain('mcp__job-hunt__save_leads')
    expect(prompt).toContain('up to 20 jobs that match the target')
    expect(prompt).toContain('do not split the list evenly')
    expect(prompt).toContain('remote=true only when')
    expect(prompt).toContain('any contract form counts')
    expect(prompt).toContain('at most 20 jobs')
  })

  test('without exclusions and a facts file the search prompt names neither', () => {
    const prompt = scanPromptOf({ target: 'Go', exclude: '', facts: '', layout: 'one list' }, EMPTY_TRACKER)

    expect(prompt).toContain('The resume is resume.txt. Search the web')
    expect(prompt).not.toContain('Skip')
    expect(prompt).toContain('Already applied to: nowhere yet')
  })

  test('demo data is dated from now and shows every stage, silence and variant', () => {
    const demo = demoOf(NOW)

    expect(funnelOf(demo.applications).map(step => step.count)).toEqual([7, 4, 2, 1])
    expect(demo.applications.filter(item => isSilent(item, NOW)).map(item => item.company)).toEqual(['Pied Piper'])
    expect(demo.applications[0]).toMatchObject({ company: 'Hooli', stage: 'offer' })
    expect(demo.variants.map(variant => [variant.name, variant.sent])).toEqual([
      ['base', 3],
      ['initech', 1],
      ['globex', 1],
      ['web', 0],
      ['hooli', 1],
      ['pied-piper', 1],
    ])
    expect(demo.leads.map(item => [item.fit, item.remote])).toEqual([
      [88, false],
      [79, false],
      [67, false],
      [46, false],
      [71, true],
      [58, true],
    ])
    expect(demo.scanned_ms).toBe(NOW - 3 * 3_600_000)
  })
})
