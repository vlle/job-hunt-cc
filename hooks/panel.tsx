import type { ClientElements, ClientModule, RenderElement } from 'claude-code'

import {
  DEFAULT_LAYOUT,
  FRESH_MS,
  STAGE_LABEL,
  daysSinceOf,
  funnelOf,
  isActive,
  isSilent,
  lastDayOf,
  nextStageOf,
  shortDayOf,
  type Application,
  type Layout,
  type Lead,
  type PanelProps,
  type Stage,
} from './hunt'
import { ACCENT, SILENCE, SPINNER, STAGE_LOOK, agoOf, dayOf, fitBarOf, fitOf, minutesOf, type Cell } from './paint'

type Item = { id: string; application: Application; lead?: undefined } | { id: string; lead: Lead; application?: undefined }
type Box = { tick: number; pickId: string | null; pickIndex: number; ids: string[]; isBusy: boolean }
type State = { tick: number; box: Box }
type Post = (act: string, id?: string) => void
type Pick = (id: string, index: number) => void
type LeadGroup = { label: string | null; note: string; isRemote: boolean | null }
type ShownGroup = LeadGroup & { count: number; shown: Lead[] }

const TICK_MS = 100
const MIN_COLUMNS = 30
const HOTKEYS = '123456789'
const ANON_KEY = 'p'
const INLINE_LEADS = 4
const RELOCATE: LeadGroup = { label: 'RELOCATE', note: 'visa or move', isRemote: false }
const REMOTE: LeadGroup = { label: 'REMOTE', note: 'from home', isRemote: true }
const LEAD_GROUPS: Record<Layout, readonly LeadGroup[]> = {
  'one list': [{ label: null, note: '', isRemote: null }],
  'relocate first': [RELOCATE, REMOTE],
  'remote first': [REMOTE, RELOCATE],
}
const CLOSE_COLUMNS = 2
const FIT_COLUMNS = 5
const COMPANY_COLUMNS = 10
const INDENT = '    '
const FUNNEL_LABEL: Partial<Record<Stage, string>> = { applied: 'sent', screen: 'screen', interview: 'interview', offer: 'offer' }

const Panel: ClientModule<PanelProps, State> = (given, surface) => {
  const props: PanelProps = { ...given, layout: given.layout ?? DEFAULT_LAYOUT }
  let box = surface.state?.box
  if (!box) {
    const created: Box = { tick: 0, pickId: null, pickIndex: 0, ids: [], isBusy: false }
    surface.every(TICK_MS, () => {
      if (created.isBusy) {
        created.tick += 1
        surface.setState({ tick: created.tick, box: created })
      }
    })
    surface.onKey(event => {
      if (event.key === ANON_KEY) {
        surface.post({ act: 'anon' })

        return
      }
      const step = event.key === 'j' || event.key === 'down' ? 1 : event.key === 'k' || event.key === 'up' ? -1 : 0
      if (step !== 0 && created.ids.length > 0) {
        const index = Math.min(created.ids.length - 1, Math.max(0, indexOf(created) + step))
        created.pickId = created.ids[index] ?? null
        created.pickIndex = index
        surface.setState({ tick: created.tick, box: created })
      }
    })
    surface.setState({ tick: 0, box: created })
    box = created
  }

  const state = box
  const width = Math.max(MIN_COLUMNS, surface.columns > 0 ? surface.columns : props.columns)
  const ui = surface.elements
  const { Box: Column, Text } = ui
  const post: Post = (act, id) => surface.post(id === undefined ? { act } : { act, id })
  const pick: Pick = (id, index) => {
    state.pickId = id
    state.pickIndex = index
    surface.setState({ tick: state.tick, box: state })
  }

  const active = props.applications.filter(isActive)
  const closed = props.applications.filter(app => !isActive(app))
  const layoutGroups = LEAD_GROUPS[props.layout] ?? LEAD_GROUPS[DEFAULT_LAYOUT]
  const groups: ShownGroup[] = layoutGroups.map(group => {
    const all = props.leads.filter(lead => group.isRemote === null || lead.remote === group.isRemote)
    const inline = Math.floor(INLINE_LEADS / layoutGroups.length)

    return { ...group, count: all.length, shown: props.isDocked ? all : all.slice(0, inline) }
  })
  const isRemoteMarked = layoutGroups.length === 1
  const leads = groups.flatMap(group => group.shown)
  const items: Item[] = [
    ...active.map(application => ({ id: `app:${application.id}`, application })),
    ...leads.map(lead => ({ id: `lead:${lead.id}`, lead })),
  ]
  state.isBusy = props.busy !== null
  state.ids = items.map(item => item.id)
  const selected = props.isDocked || state.pickId !== null ? items[indexOf(state)] : undefined

  const rows: RenderElement[] = [headOf(ui, props, state.tick, state.isBusy, width, active.length)]
  if (props.busy) {
    rows.push(
      <Text color={ACCENT}>{fitOf(`${props.busy.label}… ${minutesOf(props.now - props.busy.since_ms)}`, width)}</Text>,
    )
  }

  if (!props.hasRoot) {
    rows.push(<Text dimColor wrap="wrap">resume.txt not found: start the session inside the resume folder</Text>)

    return <Column flexDirection="column" width={width}>{rows}</Column>
  }

  if (props.isDocked) {
    rows.push(<Text> </Text>, ...resumeOf(ui, props, width))
  }

  rows.push(<Text> </Text>, ...applicationsOf(ui, props, active, closed, width))
  active.forEach((application, index) => {
    const isSelected = selected?.application === application
    rows.push(applicationRowOf(ui, application, index, isSelected, props.now, width, pick))
    if (isSelected) {
      rows.push(...applicationDetailOf(ui, application, width, post))
    }
  })
  if (closed.length > 0) {
    rows.push(closedOf(ui, closed, width))
  }

  rows.push(<Text> </Text>, leadsHeadOf(ui, props, width, post))
  if (leads.length === 0) {
    rows.push(<Text dimColor wrap="wrap"> empty — press s and Claude searches for jobs that fit the resume</Text>)
  } else {
    let first = active.length
    for (const group of groups) {
      if (group.label !== null) {
        rows.push(groupHeadOf(ui, group))
      }
      group.shown.forEach((lead, offset) => {
        const index = active.length + leads.indexOf(lead)
        const isSelected = selected?.lead === lead
        const onPick = () => pick(`lead:${lead.id}`, index)
        rows.push(leadRowOf(ui, lead, first + offset, isSelected, isRemoteMarked, props.now, width, onPick))
        if (isSelected) {
          rows.push(...leadDetailOf(ui, lead, width, props.busy !== null, post))
        }
      })
      first += group.count
    }
  }
  if (!props.isDocked && props.leads.length > leads.length) {
    rows.push(<Text dimColor>{` ${props.leads.length - leads.length} more in the dock on the right`}</Text>)
  }

  return <Column flexDirection="column" width={width}>{rows}</Column>
}

export default Panel

function indexOf(box: Box): number {
  const found = box.pickId === null ? -1 : box.ids.indexOf(box.pickId)

  return found >= 0 ? found : Math.max(0, Math.min(box.pickIndex, box.ids.length - 1))
}

function lineOf(ui: ClientElements, width: number, left: RenderElement[], right?: RenderElement): RenderElement {
  const { Box } = ui

  return (
    <Box width={width} justifyContent="space-between">
      <Box>{left}</Box>
      {right ?? null}
    </Box>
  )
}

function headOf(ui: ClientElements, props: PanelProps, tick: number, isBusy: boolean, width: number, activeCount: number): RenderElement {
  const { Text } = ui
  const glyph = isBusy ? SPINNER[tick % SPINNER.length] : '◆'

  return lineOf(
    ui,
    width - CLOSE_COLUMNS,
    [<Text color={ACCENT}>{glyph}</Text>, <Text bold> job-hunt</Text>, <Text dimColor>{` · ${activeCount} active`}</Text>],
    <Text dimColor>{dayOf(props.now)}</Text>,
  )
}

function sectionOf(ui: ClientElements, title: string, note: string): RenderElement[] {
  const { Text } = ui

  return [<Text bold color={ACCENT}>{title}</Text>, <Text dimColor>{`  ${note}`}</Text>]
}

function resumeOf(ui: ClientElements, props: PanelProps, width: number): RenderElement[] {
  const { Box, Text } = ui
  const profile = props.profile
  const title = profile ? profile.title : 'resume.txt is unreadable'
  const rows: RenderElement[] = [
    <Box>
      <Text bold color={ACCENT}>RESUME</Text>
      <Text bold>{`  ${fitOf(title, width - 8).trimEnd()}`}</Text>
    </Box>,
  ]
  const variants = props.variants
  const nameWidth = Math.min(14, Math.max(6, ...variants.map(variant => [...variant.name].length)))
  const formatWidth = Math.max(3, width - nameWidth - 12)
  const newest = Math.max(0, ...variants.map(variant => variant.updated_ms))

  for (const variant of variants) {
    const isNewest = variant.updated_ms === newest
    rows.push(
      <Box>
        <Text> </Text>
        <Text bold={isNewest} color={isNewest ? ACCENT : undefined}>{fitOf(variant.name, nameWidth)}</Text>
        <Text> </Text>
        <Text dimColor>{fitOf(variant.formats.join(' '), formatWidth)}</Text>
        <Text> </Text>
        <Text dimColor>{dayOf(variant.updated_ms)}</Text>
        <Text color="cyan">{(variant.sent > 0 ? `→${variant.sent}` : '').padStart(4)}</Text>
      </Box>,
    )
  }

  if (profile && profile.skills.length > 0) {
    const tail = profile.english ? ` · ${profile.english}` : ''
    rows.push(<Text dimColor>{fitOf(` ${profile.skills.join(' ')}${tail}`, width)}</Text>)
  }

  return rows
}

function applicationsOf(
  ui: ClientElements,
  props: PanelProps,
  active: Application[],
  closed: Application[],
  width: number,
): RenderElement[] {
  const { Box, Text } = ui
  const silent = active.filter(app => isSilent(app, props.now)).length
  const rows: RenderElement[] = [
    lineOf(
      ui,
      width,
      sectionOf(ui, 'APPLIED', `${active.length} active · ${closed.length} closed`),
      silent > 0 ? <Text color={SILENCE}>{`⚑ ${silent} silent`}</Text> : undefined,
    ),
  ]

  if (props.isDocked && props.applications.length > 0) {
    const steps = funnelOf(props.applications).flatMap((step, index) => [
      <Text dimColor>{`${index > 0 ? ' › ' : ' '}${FUNNEL_LABEL[step.stage] ?? step.stage} `}</Text>,
      step.count > 0
        ? <Text bold color={STAGE_LOOK[step.stage].color}>{String(step.count)}</Text>
        : <Text dimColor>0</Text>,
    ])
    rows.push(<Box>{steps}</Box>)
  }

  if (active.length === 0) {
    rows.push(<Text dimColor> nothing active — press a on a job to log an application</Text>)
  }

  return rows
}

function buttonOf(ui: ClientElements, key: string, index: number, label: string, onPress: () => void): RenderElement[] {
  const { Button, Text } = ui
  const hotkey = HOTKEYS[index]

  return hotkey
    ? [<Button key={key} hotkey={hotkey} plain onPress={onPress}>{label}</Button>]
    : [<Text>{'   '}</Text>, <Button key={key} plain onPress={onPress}>{label}</Button>]
}

function markerOf(ui: ClientElements, isSelected: boolean, isFresh: boolean): RenderElement {
  const { Text } = ui

  return <Text color={ACCENT} bold>{isSelected ? '›' : isFresh ? '•' : ' '}</Text>
}

function applicationRowOf(
  ui: ClientElements,
  app: Application,
  index: number,
  isSelected: boolean,
  now: number,
  width: number,
  pick: Pick,
): RenderElement {
  const { Box, Text } = ui
  const look = STAGE_LOOK[app.stage]
  const days = daysSinceOf(lastDayOf(app) ?? '', now)
  const isQuiet = isSilent(app, now)
  const status = isQuiet ? `⚑ ${days}d` : `${STAGE_LABEL[app.stage]} ${days}d`
  const labelWidth = Math.max(8, width - 1 - 3 - 1 - 2 - [...status].length)
  const label = fitOf(`${fitOf(app.company, COMPANY_COLUMNS)} ${app.role}`, labelWidth)
  const id = `app:${app.id}`

  return (
    <Box>
      {markerOf(ui, isSelected, false)}
      {buttonOf(ui, `hunt:${id}`, index, label, () => pick(id, index))}
      <Text> </Text>
      <Text color={look.color}>{look.glyph}</Text>
      <Text color={isQuiet ? SILENCE : undefined} dimColor={!isQuiet}>{` ${status}`}</Text>
    </Box>
  )
}

function applicationDetailOf(ui: ClientElements, app: Application, width: number, post: Post): RenderElement[] {
  const { Text } = ui
  const next = nextStageOf(app.stage)
  const trail = app.history.map(step => `${shortDayOf(step.on)} ${STAGE_LABEL[step.stage]}`).join(' → ')
  const extra = [app.resume ? `resume ${app.resume}` : '', app.note ?? ''].filter(Boolean).join(' · ')
  const rows: RenderElement[] = [<Text dimColor>{fitOf(`${INDENT}${trail}`, width)}</Text>]

  if (extra) {
    rows.push(<Text dimColor>{fitOf(`${INDENT}${extra}`, width)}</Text>)
  }

  rows.push(
    actionsOf(ui, [
      next ? { key: 'next', hotkey: 'n', label: `→ ${STAGE_LABEL[next]}`, onPress: () => post('next', app.id) } : undefined,
      { key: 'reject', hotkey: 'r', label: 'rejected', onPress: () => post('reject', app.id) },
    ]),
    actionsOf(ui, [
      { key: 'close', hotkey: 'c', label: 'close', onPress: () => post('close', app.id) },
      app.url ? { key: 'open-app', hotkey: 'o', label: 'open', onPress: () => post('open', `app:${app.id}`) } : undefined,
    ]),
  )

  return rows
}

function closedOf(ui: ClientElements, closed: Application[], width: number): RenderElement {
  const { Box, Text } = ui
  const parts: RenderElement[] = [<Text> </Text>]
  let used = 1

  for (const [index, app] of closed.entries()) {
    const look = STAGE_LOOK[app.stage]
    const text = ` ${app.company}  `
    const rest = closed.length - index
    if (used + 1 + [...text].length > width - 4 && rest > 0) {
      parts.push(<Text dimColor>{`+${rest}`}</Text>)
      break
    }
    parts.push(<Text color={look.color} dimColor>{look.glyph}</Text>, <Text dimColor>{text}</Text>)
    used += 1 + [...text].length
  }

  return <Box>{parts}</Box>
}

function leadsHeadOf(ui: ClientElements, props: PanelProps, width: number, post: Post): RenderElement {
  const { Button } = ui
  const scanned = props.scanned_ms === null ? 'not scanned yet' : `scanned ${agoOf(props.scanned_ms, props.now)}`

  return lineOf(
    ui,
    width,
    sectionOf(ui, 'JOBS', `${props.leads.length} · ${scanned}`),
    <Button key="hunt:scan" hotkey="s" plain dimColor={props.busy !== null} onPress={() => post('scan')}>search</Button>,
  )
}

function groupHeadOf(ui: ClientElements, group: ShownGroup): RenderElement {
  const { Box, Text } = ui

  return (
    <Box>
      <Text bold>{` ${group.label}`}</Text>
      <Text dimColor>{`  ${group.count} · ${group.note}`}</Text>
    </Box>
  )
}

function leadRowOf(
  ui: ClientElements,
  lead: Lead,
  row: number,
  isSelected: boolean,
  isRemoteMarked: boolean,
  now: number,
  width: number,
  onPick: () => void,
): RenderElement {
  const { Box, Text } = ui
  const mark = lead.remote && isRemoteMarked ? '⌂' : lead.sponsor ? '✈' : ' '
  const labelWidth = Math.max(8, width - 1 - 3 - 1 - FIT_COLUMNS - 1 - 4)
  const label = fitOf(`${fitOf(lead.company, COMPANY_COLUMNS)} ${lead.title}`, labelWidth)

  return (
    <Box>
      {markerOf(ui, isSelected, now - lead.found_ms < FRESH_MS)}
      {buttonOf(ui, `hunt:lead:${lead.id}`, row, label, onPick)}
      <Text> </Text>
      {cellsOf(ui, fitBarOf(lead.fit, FIT_COLUMNS))}
      <Text dimColor>{` ${fitOf(lead.country, 3)}`}</Text>
      <Text color={ACCENT}>{mark}</Text>
    </Box>
  )
}

function leadDetailOf(ui: ClientElements, lead: Lead, width: number, isBusy: boolean, post: Post): RenderElement[] {
  const { Text } = ui
  const facts = [`fit ${lead.fit}`, lead.salary ?? '', lead.location, lead.posted ? shortDayOf(lead.posted) : '']
    .filter(Boolean)
    .join(' · ')
  const rows: RenderElement[] = wrapOf(facts, width - INDENT.length, 2).map(line => <Text>{`${INDENT}${line}`}</Text>)

  for (const line of wrapOf(lead.why ?? '', width - INDENT.length, 2)) {
    rows.push(<Text dimColor>{`${INDENT}${line}`}</Text>)
  }

  rows.push(
    actionsOf(ui, [
      { key: 'apply', hotkey: 'a', label: 'applied', onPress: () => post('apply', lead.id) },
      { key: 'tailor', hotkey: 't', label: 'tailor', dimColor: isBusy, onPress: () => post('tailor', lead.id) },
    ]),
    actionsOf(ui, [
      { key: 'hide', hotkey: 'x', label: 'hide', onPress: () => post('hide', lead.id) },
      { key: 'open-lead', hotkey: 'o', label: 'open', onPress: () => post('open', `lead:${lead.id}`) },
    ]),
  )

  return rows
}

type Action = { key: string; hotkey: string; label: string; dimColor?: boolean; onPress: () => void }

function actionsOf(ui: ClientElements, actions: (Action | undefined)[]): RenderElement {
  const { Box, Button, Text } = ui
  const parts: RenderElement[] = [<Text>{INDENT}</Text>]

  for (const action of actions) {
    if (!action) {
      continue
    }
    if (parts.length > 1) {
      parts.push(<Text>{'   '}</Text>)
    }
    parts.push(
      <Button key={`hunt:${action.key}`} hotkey={action.hotkey} plain dimColor={action.dimColor === true} onPress={action.onPress}>
        {action.label}
      </Button>,
    )
  }

  return <Box>{parts}</Box>
}

function wrapOf(text: string, width: number, maxLines: number): string[] {
  const lines: string[] = []
  let line = ''

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if ([...next].length > width && line) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) {
    lines.push(line)
  }
  if (lines.length <= maxLines) {
    return lines
  }

  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = fitOf(lines.slice(maxLines - 1).join(' '), width).trimEnd()

  return kept
}

function cellsOf(ui: ClientElements, cells: readonly Cell[]): RenderElement[] {
  const { Text } = ui
  const groups: Cell[] = []

  for (const cell of cells) {
    const last = groups[groups.length - 1]
    if (last && last.color === cell.color && last.dim === cell.dim && last.bold === cell.bold) {
      last.ch += cell.ch
    } else {
      groups.push({ ...cell })
    }
  }

  return groups.map(group => (
    <Text color={group.color} dimColor={group.dim} bold={group.bold}>{group.ch}</Text>
  ))
}
