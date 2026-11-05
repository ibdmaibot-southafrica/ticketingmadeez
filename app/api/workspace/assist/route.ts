import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { COOKIE, readSession } from '@/lib/security'
import { getInstall, isPaidTier, getPool } from '@/lib/kv'
import { getFeaturePlan } from '@/lib/entitlements'
import { listHubItems, type Article } from '@/lib/hub-store'
import {
  relevantArticles,
  knowledgeDraft,
  draftInputByteBound,
} from '@/lib/knowledge-assist'
import { getAiSettings, reserveAiBudget, settleAiBudget } from '@/lib/ai-budget'
import { aiProviderConfig, aiCostMicros } from '@/lib/ai-config'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest) {
  const parsed = z
    .object({
      locationId: z.string().min(1),
      question: z.string().trim().min(3).max(1500),
      consent: z.literal(true),
    })
    .strict()
    .safeParse(await req.json().catch(() => null))
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Enter a question and confirm the AI disclosure' },
      { status: 400 },
    )
  const { locationId, question } = parsed.data,
    session = readSession(req.cookies.get(COOKIE)?.value)
  if (!session || session.locationId !== locationId || session.role !== 'admin')
    return NextResponse.json(
      { error: 'Administrator access required' },
      { status: 403 },
    )
  const limit = Number(process.env.TMEZ_AI_DAILY_LIMIT || 0)
  const settings = await getAiSettings(locationId),
    provider = aiProviderConfig(settings.provider)
  if (
    !settings.enabled ||
    !provider.configured ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1000
  )
    return NextResponse.json(
      {
        error:
          'AI drafts are off. Enable them in AI controls after the operator configures a provider, model, token pricing and daily request limit.',
      },
      { status: 503 },
    )
  const install = await getInstall(locationId)
  if (!install || !isPaidTier(getFeaturePlan(install)))
    return NextResponse.json(
      { error: 'AI drafts require Pro or Enterprise access' },
      { status: 402 },
    )
  try {
    const articles = relevantArticles(
      question,
      await listHubItems<Article>(locationId, 'article'),
    )
    if (!articles.length)
      return NextResponse.json({
        draft:
          'No published article matches this question. Ask the support team to help.',
        sources: [],
      })
    await getPool().query(
      'CREATE TABLE IF NOT EXISTS tmez_ai_usage(location_id TEXT NOT NULL,day DATE NOT NULL,requests INT NOT NULL,PRIMARY KEY(location_id,day))',
    )
    const budget = await getPool().query(
      "INSERT INTO tmez_ai_usage(location_id,day,requests) VALUES($1,(NOW() AT TIME ZONE 'Africa/Johannesburg')::date,1) ON CONFLICT(location_id,day) DO UPDATE SET requests=tmez_ai_usage.requests+1 WHERE tmez_ai_usage.requests<$2 RETURNING requests",
      [locationId, limit],
    )
    if (!budget.rowCount)
      return NextResponse.json(
        {
          error:
            'Daily AI request limit reached. You can still search articles and reply directly.',
        },
        { status: 429 },
      )
    const reserveMicros = Math.max(
      1,
      aiCostMicros(
        draftInputByteBound(question, articles),
        provider.outputTokenReserve,
        provider.inputRate,
        provider.outputRate,
      ),
    )
    const requestId = await reserveAiBudget(
      locationId,
      reserveMicros,
      settings.monthlyLimitUsd,
    )
    if (!requestId)
      return NextResponse.json(
        {
          error:
            'Monthly AI budget reached, including pending request reservations. AI is paused until the next month or an administrator changes the limit.',
        },
        { status: 429 },
      )
    // Failures retain their reservation because the provider may have billed a timed-out call.
    // This is conservative accounting, not a promise about the provider's final invoice.
    const result = await knowledgeDraft(question, articles, settings.provider)
    if (result.inputTokens !== undefined && result.outputTokens !== undefined)
      await settleAiBudget(
        locationId,
        requestId,
        aiCostMicros(
          result.inputTokens,
          result.outputTokens,
          provider.inputRate,
          provider.outputRate,
        ),
      )
    return NextResponse.json({
      draft: result.text,
      sources: articles.map((a) => ({ id: a.id, title: a.data.title })),
      reviewRequired: true,
    })
  } catch {
    return NextResponse.json(
      {
        error:
          'AI draft unavailable. Search the help articles or reply directly.',
      },
      { status: 503 },
    )
  }
}
