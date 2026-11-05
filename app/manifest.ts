import type { MetadataRoute } from 'next'
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TicketingMadeEZ Support',
    short_name: 'TicketingMadeEZ',
    description: 'Your support ticket and conversation in one place.',
    start_url: '/portal',
    scope: '/',
    display: 'standalone',
    background_color: '#0B1628',
    theme_color: '#0B1628',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  }
}
