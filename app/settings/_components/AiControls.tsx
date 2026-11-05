'use client'
import { useState } from 'react'
import { AI_BRACKETS, type AiSettings, type AiProvider } from '@/lib/ai-config'
import { OpenAiConnection } from './OpenAiConnection'
export type AiControlData = {
  settings: AiSettings
  budget: { spentMicros: number; reservedMicros: number }
  providers: {
    provider: AiProvider
    name: string
    configured: boolean
    model: string | null
    connected:boolean
  }[]
}
export function AiControls({
  data,
  busy,
  save,
  locationId,onConnectionChange,
}: {
  data: AiControlData
  busy: boolean
  save: (value: AiSettings) => Promise<boolean>
  locationId:string
  onConnectionChange:()=>void
}) {
  const [settings, setSettings] = useState<AiSettings>(data.settings)
  const range = AI_BRACKETS[settings.bracket],
    provider = data.providers.find((p) => p.provider === settings.provider)
  const liveProvider = data.providers.find(
    (p) => p.provider === data.settings.provider,
  )
  const status = !data.settings.enabled
    ? 'Off'
    : !liveProvider?.configured
      ? 'Setup required'
      : data.budget.spentMicros + data.budget.reservedMicros >=
          data.settings.monthlyLimitUsd * 1000000
        ? 'Paused at budget limit'
        : 'On'
  const field =
    'mt-1 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm'
  return (
    <section className="workspace-panel">
      <div className="mb-5 rounded-xl border-2 border-[#0891B2] bg-cyan/10 p-4"><p className="font-heading text-lg font-bold">AI usage is not included</p><p className="mt-2 text-sm">Your 14-day app trial and app subscription do not include AI usage or AI credits. Connect your own OpenAI API account. OpenAI bills you directly. TicketingMadeEZ does not rebill or pay your AI charges.</p><a href="/help#connect-openai" target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold underline">Step-by-step OpenAI setup guide</a></div>
      <OpenAiConnection locationId={locationId} connected={!!data.providers.find(p=>p.provider==='openai')?.connected} onChange={onConnectionChange}/>
      <div className="flex items-center justify-between gap-4">
        <h2>AI controls</h2>
        <span className="text-sm font-semibold">{status}</span>
      </div>
      <p className="mt-2 text-xs text-ink/60">
        AI is optional. Switching off stops new drafts; an existing request may
        finish. Budget brackets are usage ceilings, not subscription prices or
        automatic charges.
      </p>
      <form
        className="mt-4 grid gap-4 md:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault()
          await save(settings)
        }}
      >
        <label className="text-xs">
          AI provider
          <select
            className={field}
            value={settings.provider}
            disabled={busy}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                provider: e.target.value as AiProvider,
                enabled: false,
              }))
            }
          >
            {data.providers.map((p) => (
              <option key={p.provider} value={p.provider}>
                {p.name}
                {p.configured ? '' : p.provider==='openai'?' · connect your API key':' · advanced setup required'}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Monthly AI budget bracket
          <select
            className={field}
            disabled={busy}
            value={settings.bracket}
            onChange={(e) => {
              const bracket = e.target.value as AiSettings['bracket'],
                range = AI_BRACKETS[bracket]
              setSettings((s) => ({
                ...s,
                bracket,
                monthlyLimitUsd: Math.max(
                  range.min,
                  Math.min(range.max, s.monthlyLimitUsd),
                ),
              }))
            }}
          >
            {Object.entries(AI_BRACKETS).map(([id, r]) => (
              <option key={id} value={id}>
                USD {r.min} to {r.max}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          Exact monthly limit, USD
          <input
            type="number"
            className={field}
            min={range.min}
            max={range.max}
            step={1}
            required
            disabled={busy}
            value={settings.monthlyLimitUsd}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                monthlyLimitUsd: Number(e.target.value),
              }))
            }
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={busy || !provider?.configured}
            onChange={(e) =>
              setSettings((s) => ({ ...s, enabled: e.target.checked }))
            }
          />
          Enable AI drafts
        </label>
        <div className="flex flex-wrap gap-3">
          <button
            disabled={busy}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            Save AI controls
          </button>
          {data.settings.enabled && (
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-ink/30 px-4 py-2 text-sm font-semibold"
              onClick={() => void save({ ...data.settings, enabled: false })}
            >
              Turn AI off
            </button>
          )}
        </div>
      </form>
      <div className="mt-4 border-t border-ink/10 pt-3 text-xs text-ink/60">
        <p>
          Recorded usage this month: USD{' '}
          {(data.budget.spentMicros / 1000000).toFixed(4)} · Held for pending or
          unconfirmed requests: USD{' '}
          {(data.budget.reservedMicros / 1000000).toFixed(4)}
        </p>
        <p className="mt-2">
          Calendar month in South African time. The app reserves budget before
          generating a draft and pauses new drafts when no budget remains. This
          does not control the provider's final invoice or charges outside this
          app.
        </p>
        <p className="mt-2">
          {provider?.configured
            ? `Configured model: ${provider.model}`
            : 'Connect your own OpenAI API key above. The recommended GPT-5.4 mini model is already selected. OpenAI bills AI usage directly to your account.'}
        </p>
      </div>
    </section>
  )
}
