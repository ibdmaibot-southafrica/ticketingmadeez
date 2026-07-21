import { SettingsNav } from './_components/SettingsNav'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex bg-slate-50 text-ink font-body">
      <aside className="w-56 shrink-0 bg-[#0A0F1F] text-white flex flex-col">
        <div className="px-5 py-6 border-b border-white/5 flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-cyan to-cyan/60 flex items-center justify-center text-ink font-bold">T</div>
          <div className="text-sm font-heading font-bold tracking-tight">TicketingMadeEZ</div>
        </div>
        <SettingsNav />
        <div className="mt-auto p-4 border-t border-white/5 text-[11px] text-white/40">
          By NexBDM<sup>&trade;</sup>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-auto">{children}</main>
    </div>
  )
}
