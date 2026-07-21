import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'TicketingMadeEZ',
  description: 'Support ticketing helpdesk for GHL sub-accounts. Native pipelines, email-to-ticket, workflow automation, SLA tracking.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
