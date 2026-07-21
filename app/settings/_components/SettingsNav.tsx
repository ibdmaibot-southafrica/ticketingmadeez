'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

const NAV = [
  { href: '/settings/tickets', label: 'Tickets' },
  { href: '/settings/departments', label: 'Departments' },
  { href: '/settings/sla', label: 'SLA policies' },
  { href: '/settings/reports', label: 'Reports' },
  { href: '/settings/config', label: 'Settings' },
]

export function SettingsNav() {
  const pathname = usePathname()
  const params = useSearchParams()
  const qs = params.toString() ? `?${params.toString()}` : ''

  return (
    <nav className="flex flex-col gap-1 p-3">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + '/')
        return (
          <Link
            key={item.href}
            href={`${item.href}${qs}`}
            className={
              'px-3 py-2 rounded-md text-sm transition-colors ' +
              (active
                ? 'bg-cyan/15 text-cyan'
                : 'text-white/70 hover:text-white hover:bg-white/5')
            }
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
