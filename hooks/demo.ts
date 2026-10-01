import {
  DAY_MS,
  idOf,
  sortedApplicationsOf,
  todayOf,
  variantsOf,
  type Application,
  type FileEntry,
  type Lead,
  type PanelProps,
  type Stage,
} from './hunt'

type Demo = Pick<PanelProps, 'profile' | 'variants' | 'applications' | 'leads' | 'scanned_ms'>
type DemoApplication = Pick<Application, 'company' | 'role' | 'resume' | 'note'> & { steps: readonly (readonly [Stage, number])[] }
type DemoLead = Omit<Lead, 'id' | 'url' | 'posted' | 'found_ms'> & { postedDaysAgo: number; foundDaysAgo: number }

const HOUR_MS = 3_600_000
const JOBS_URL = 'https://example.com/jobs'
const PDF = 'Alex-Doe-Backend-Engineer.pdf'
const BASE_DAYS_AGO = 2
const FOLDERS: readonly (readonly [string, number])[] = [
  ['hooli', 21],
  ['globex', 12],
  ['initech', 9],
  ['pied-piper', 25],
]

const APPLICATIONS: readonly DemoApplication[] = [
  {
    company: 'Hooli',
    role: 'Senior Backend Engineer, Payments',
    resume: 'hooli/',
    note: 'offer call on Friday',
    steps: [['applied', 21], ['screen', 17], ['interview', 10], ['offer', 1]],
  },
  {
    company: 'Globex',
    role: 'Backend Engineer (Go)',
    resume: 'globex/',
    note: 'system design round booked',
    steps: [['applied', 12], ['screen', 8], ['interview', 3]],
  },
  {
    company: 'Initech',
    role: 'Software Engineer, Core Services',
    resume: 'initech/',
    note: 'recruiter call went well',
    steps: [['applied', 9], ['screen', 4]],
  },
  { company: 'Acme', role: 'Go Developer, Platform', resume: 'resume.txt', note: null, steps: [['applied', 2]] },
  { company: 'Pied Piper', role: 'Backend Engineer, Storage', resume: 'pied-piper/', note: null, steps: [['applied', 25]] },
  {
    company: 'Umbrella',
    role: 'Backend Engineer',
    resume: 'resume.txt',
    note: 'went with a more senior candidate',
    steps: [['applied', 30], ['screen', 24], ['rejected', 18]],
  },
  { company: 'Soylent', role: 'Go Engineer', resume: 'resume.txt', note: 'role filled internally', steps: [['applied', 40], ['closed', 20]] },
]

const LEADS: readonly DemoLead[] = [
  {
    company: 'Vandelay',
    title: 'Backend Engineer, Logistics',
    location: 'London, hybrid',
    country: 'UK',
    sponsor: true,
    remote: false,
    salary: '£80–100k',
    fit: 88,
    why: 'Go, Kafka and Postgres match; AWS is a gap',
    postedDaysAgo: 3,
    foundDaysAgo: 1,
  },
  {
    company: 'Cyberdyne',
    title: 'Senior Go Engineer',
    location: 'Amsterdam',
    country: 'NL',
    sponsor: true,
    remote: false,
    salary: '€75–90k',
    fit: 79,
    why: 'strong Go and k8s overlap; wants deeper gRPC',
    postedDaysAgo: 5,
    foundDaysAgo: 1,
  },
  {
    company: 'Tyrell',
    title: 'Platform Engineer (Go)',
    location: 'Berlin, hybrid',
    country: 'DE',
    sponsor: true,
    remote: false,
    salary: null,
    fit: 67,
    why: 'platform focus; Terraform is missing',
    postedDaysAgo: 8,
    foundDaysAgo: 6,
  },
  {
    company: 'Stark',
    title: 'Go Backend Engineer',
    location: 'Dublin',
    country: 'IE',
    sponsor: true,
    remote: false,
    salary: null,
    fit: 46,
    why: 'heavy AWS and DynamoDB; level may be too senior',
    postedDaysAgo: 14,
    foundDaysAgo: 9,
  },
  {
    company: 'Aperture',
    title: 'Go Engineer, Billing',
    location: 'Remote, worldwide',
    country: 'WW',
    sponsor: false,
    remote: true,
    salary: '$90–110k',
    fit: 71,
    why: 'contractor through an EOR; Go and Postgres match',
    postedDaysAgo: 4,
    foundDaysAgo: 1,
  },
  {
    company: 'Wonka',
    title: 'Backend Engineer, Checkout',
    location: 'Remote, EMEA',
    country: 'EU',
    sponsor: false,
    remote: true,
    salary: '€60–75k',
    fit: 58,
    why: 'hires across EMEA; stack is Go plus MongoDB',
    postedDaysAgo: 11,
    foundDaysAgo: 6,
  },
]

export function demoOf(now: number): Demo {
  const dayOf = (daysAgo: number) => todayOf(now - daysAgo * DAY_MS)
  const applications = APPLICATIONS.map(({ steps, ...demo }): Application => {
    const id = `demo-${idOf(demo.company)}`
    const history = steps.map(([stage, daysAgo]) => ({ stage, on: dayOf(daysAgo) }))

    return { ...demo, id, url: `${JOBS_URL}/${id}`, stage: history.at(-1)?.stage ?? 'applied', history }
  })
  const leads = LEADS.map(({ postedDaysAgo, foundDaysAgo, ...demo }): Lead => {
    const url = `${JOBS_URL}/${idOf(`${demo.company} ${demo.title}`)}`

    return { ...demo, id: url.replace(/^https:\/\//, ''), url, posted: dayOf(postedDaysAgo), found_ms: now - foundDaysAgo * DAY_MS }
  })
  const fileOf = (dir: string, name: string, daysAgo: number): FileEntry => ({ dir, name, mtime_ms: now - daysAgo * DAY_MS })
  const files = [
    ...['resume.txt', 'resume.html', PDF].map(name => fileOf('', name, BASE_DAYS_AGO)),
    fileOf('', 'resume-web.html', 15),
    ...FOLDERS.flatMap(([dir, daysAgo]) => ['resume.txt', 'resume.html', PDF].map(name => fileOf(dir, name, daysAgo))),
  ]

  return {
    profile: {
      name: 'Alex Doe',
      title: 'Backend Software Engineer — Go',
      place: null,
      skills: ['Go', 'SQL', 'PG', 'Redis', 'Kafka', 'CH', 'k8s'],
      english: 'EN C1',
    },
    variants: variantsOf(files, applications),
    applications: sortedApplicationsOf(applications),
    leads,
    scanned_ms: now - 3 * HOUR_MS,
  }
}
