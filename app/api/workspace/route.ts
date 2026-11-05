import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE, readSession } from '@/lib/security'
import { getInstall, isPaidTier } from '@/lib/kv'
import { getFeaturePlan } from '@/lib/entitlements'
import {
  listHubItems,
  saveHubItem,
  listTimeEntries,
  startTimer,
  stopTimer,
  addManualTime,
  type Project,
  type Article,
  type Task,
} from '@/lib/hub-store'
import { listActiveUsers, displayName } from '@/lib/users'
import { ticketAccess } from '@/lib/ticket-access'
import { getAiSettings, getAiBudget, saveAiSettings } from '@/lib/ai-budget'
import { customerAiKey,customerAiConnections } from '@/lib/ai-credentials'
import {
  AI_BRACKETS,
  aiProviderOptions,
  aiProviderConfig,
} from '@/lib/ai-config'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const ProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    description: z.string().max(10000),
    status: z.enum(['planned', 'active', 'completed']),
    hourlyRate: z.number().min(0).max(1000000).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    members: z.array(z.string()).max(100).optional(),
    visibility: z.enum(['account', 'members']).optional(),
    userRates: z
      .array(
        z
          .object({
            userId: z.string(),
            hourlyRate: z.number().min(0).max(1000000),
            currency: z.string().regex(/^[A-Z]{3}$/),
          })
          .strict(),
      )
      .max(100)
      .optional(),
  })
  .strict()
const TaskSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    projectId: z.string().min(1),
    status: z.enum(['todo', 'doing', 'done']),
    assignedTo: z.string().optional(),
    dueAt: z.string().datetime().nullable().optional(),
    ticketId: z.string().optional(),
  })
  .strict()
const ArticleSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(50000),
    published: z.boolean(),
  })
  .strict()
const Schema = z
  .object({
    locationId: z.string().min(1),
    action: z.enum([
      'project',
      'task',
      'article',
      'timer-start',
      'timer-stop',
      'manual-time',
      'ai-settings',
    ]),
    id: z.string().uuid().optional(),
    data: z.unknown(),
  })
  .strict()
export async function GET(req: NextRequest) {
  const locationId = req.nextUrl.searchParams.get('locationId')!
  const session = readSession(req.cookies.get(COOKIE)?.value)
  if (!session || session.locationId !== locationId)
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 },
    )
  const install = await getInstall(locationId)
  if (!install || !isPaidTier(getFeaturePlan(install)))
    return NextResponse.json(
      { error: 'Workspace tools require Pro or Enterprise access' },
      { status: 402 },
    )
  try {
    const [projects, tasks, articles, time, users] = await Promise.all([
      listHubItems<Project>(locationId, 'project'),
      listHubItems<Task>(locationId, 'task'),
      listHubItems<Article>(locationId, 'article'),
      listTimeEntries(locationId),
      listActiveUsers(locationId),
    ])
    const visibleProjects = projects.filter(
      (p) =>
        session.role === 'admin' ||
        p.data.visibility !== 'members' ||
        p.data.members?.includes(session.userId),
    )
    const allowedProjects = new Set(visibleProjects.map((p) => p.id))
    return NextResponse.json({
      projects: visibleProjects.map((p) =>
        session.role === 'admin'
          ? p
          : {
              ...p,
              data: {
                title: p.data.title,
                description: p.data.description,
                status: p.data.status,
                members: p.data.members,
                visibility: p.data.visibility,
              },
            },
      ),
      tasks: tasks.filter((t) => allowedProjects.has(t.data.projectId)),
      articles,
      time:
        session.role === 'admin'
          ? time
          : time
              .filter(
                (t) =>
                  t.userId === session.userId &&
                  (allowedProjects.has(t.projectId) || !t.endedAt),
              )
              .map((t) => ({ ...t, rateMinor: null, currency: null })),
      users: users.map((u) => ({ id: u.id, name: displayName(u) })),
      userId: session.userId,
      admin: session.role === 'admin',
      ...(session.role === 'admin'
        ? {
            ai: {
              settings: await getAiSettings(locationId),
              budget: await getAiBudget(locationId),
              providers: aiProviderOptions((await customerAiConnections(locationId)).map(c=>c.provider)),
            },
          }
        : {}),
    })
  } catch {
    return NextResponse.json(
      { error: 'Unable to load the workspace' },
      { status: 503 },
    )
  }
}
export async function POST(req: NextRequest) {
  if (Number(req.headers.get('content-length') || 0) > 100000)
    return NextResponse.json({ error: 'Update is too large' }, { status: 413 })
  const parsed = Schema.safeParse(await req.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid workspace update' },
      { status: 400 },
    )
  const { locationId, action, id, data } = parsed.data
  const session = readSession(req.cookies.get(COOKIE)?.value)
  if (!session || session.locationId !== locationId)
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 },
    )
  const install = await getInstall(locationId)
  if (!install || !isPaidTier(getFeaturePlan(install)))
    return NextResponse.json(
      { error: 'Workspace tools require Pro or Enterprise access' },
      { status: 402 },
    )
  if (
    ['article', 'project', 'ai-settings'].includes(action) &&
    session.role !== 'admin'
  )
    return NextResponse.json(
      { error: 'Administrator access required' },
      { status: 403 },
    )
  try {
    if (action === 'ai-settings') {
      const settings = z
        .object({
          enabled: z.boolean(),
          provider: z.enum(['openai', 'anthropic', 'gemini']),
          bracket: z.enum(['10-50', '50-100', '100-500']),
          monthlyLimitUsd: z.number().int(),
        })
        .strict()
        .parse(data)
      const range = AI_BRACKETS[settings.bracket]
      if (
        settings.monthlyLimitUsd < range.min ||
        settings.monthlyLimitUsd > range.max
      )
        return NextResponse.json(
          { error: 'Choose a monthly limit within the selected bracket' },
          { status: 400 },
        )
      if (
        settings.enabled &&
        (!aiProviderConfig(settings.provider,await customerAiKey(locationId,settings.provider)).configured ||
          !Number.isInteger(Number(process.env.TMEZ_AI_DAILY_LIMIT ?? 1000)) || Number(process.env.TMEZ_AI_DAILY_LIMIT ?? 1000) < 1 || Number(process.env.TMEZ_AI_DAILY_LIMIT ?? 1000) > 1000)
      )
        return NextResponse.json(
          {
            error:
              'Connect your own OpenAI API key before enabling AI. AI usage is billed directly to you by OpenAI and is not included in the trial or app subscription.',
          },
          { status: 409 },
        )
      await saveAiSettings(locationId, settings)
      return NextResponse.json({ ok: true })
    }
    if (action === 'project') {
      const value = ProjectSchema.parse(data)
      if (value.hourlyRate !== undefined && !value.currency)
        return NextResponse.json(
          { error: 'Choose a currency for the hourly rate' },
          { status: 400 },
        )
      const users = await listActiveUsers(locationId)
      if (
        [
          ...(value.members ?? []),
          ...(value.userRates ?? []).map((r) => r.userId),
        ].some((id) => !users.some((u) => u.id === id))
      )
        return NextResponse.json(
          { error: 'Choose active team members in this account' },
          { status: 400 },
        )
      if (
        new Set(value.userRates?.map((r) => r.userId)).size !==
        (value.userRates?.length ?? 0)
      )
        return NextResponse.json(
          { error: 'Use one rate per team member' },
          { status: 400 },
        )
      return NextResponse.json({
        ok: true,
        id: await saveHubItem(locationId, 'project', value, id),
      })
    }
    if (action === 'article')
      return NextResponse.json({
        ok: true,
        id: await saveHubItem(
          locationId,
          'article',
          ArticleSchema.parse(data),
          id,
        ),
      })
    const projects = await listHubItems<Project>(locationId, 'project')
    const visibleProjects = projects.filter(
      (p) =>
        session.role === 'admin' ||
        p.data.visibility !== 'members' ||
        p.data.members?.includes(session.userId),
    )
    if (action === 'task') {
      const value = TaskSchema.parse(data)
      const project = visibleProjects.find((p) => p.id === value.projectId)
      if (!project)
        return NextResponse.json(
          { error: 'Project not found in this account' },
          { status: 400 },
        )
      if (id) {
        const existing = (await listHubItems<Task>(locationId, 'task')).find(
          (t) => t.id === id,
        )
        if (
          !existing ||
          !visibleProjects.some((p) => p.id === existing.data.projectId)
        )
          return NextResponse.json(
            { error: 'Task access denied' },
            { status: 403 },
          )
      }
      if (
        value.assignedTo &&
        project.data.visibility === 'members' &&
        !project.data.members?.includes(value.assignedTo)
      )
        return NextResponse.json(
          { error: 'Assign this private task to a project team member' },
          { status: 400 },
        )
      if (value.ticketId && !(await ticketAccess(locationId, value.ticketId)))
        return NextResponse.json(
          { error: 'Support ticket not found in this account' },
          { status: 403 },
        )
      if (
        value.assignedTo &&
        !(await listActiveUsers(locationId)).some(
          (u) => u.id === value.assignedTo,
        )
      )
        return NextResponse.json(
          { error: 'Choose an active team member' },
          { status: 400 },
        )
      return NextResponse.json({
        ok: true,
        id: await saveHubItem(locationId, 'task', value, id),
      })
    }
    if (action === 'timer-stop')
      return NextResponse.json({
        ok: await stopTimer(locationId, session.userId),
      })
    const timer = z
      .object({
        projectId: z.string(),
        description: z.string().trim().min(1).max(1000),
        billable: z.boolean(),
        minutes: z.number().int().min(1).max(1440).optional(),
      })
      .strict()
      .parse(data)
    const project = visibleProjects.find((p) => p.id === timer.projectId)
    if (!project)
      return NextResponse.json(
        { error: 'Project not found in this account' },
        { status: 400 },
      )
    const staffRate = project.data.userRates?.find(
      (r) => r.userId === session.userId,
    )
    const hourlyRate = staffRate?.hourlyRate ?? project.data.hourlyRate,
      currency = staffRate?.currency ?? project.data.currency
    const rateMinor =
      hourlyRate === undefined ? undefined : Math.round(hourlyRate * 100)
    if (action === 'timer-start')
      await startTimer(
        locationId,
        session.userId,
        timer.projectId,
        timer.description,
        timer.billable,
        rateMinor,
        currency,
      )
    else {
      if (!timer.minutes)
        return NextResponse.json(
          { error: 'Enter minutes worked' },
          { status: 400 },
        )
      await addManualTime(
        locationId,
        session.userId,
        timer.projectId,
        timer.description,
        timer.minutes,
        timer.billable,
        rateMinor,
        currency,
      )
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof z.ZodError)
      return NextResponse.json(
        { error: 'Check the fields and try again' },
        { status: 400 },
      )
    return NextResponse.json(
      {
        error: 'Unable to save. If a timer is already running, stop it first.',
      },
      { status: 409 },
    )
  }
}
