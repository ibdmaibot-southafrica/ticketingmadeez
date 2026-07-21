import { z } from 'zod'

const envSchema = z.object({
  GHL_CLIENT_ID: z.string().min(1),
  GHL_CLIENT_SECRET: z.string().min(1),
  GHL_APP_ID: z.string().min(1),
  GHL_API_BASE: z.string().url().default('https://services.leadconnectorhq.com'),
  GHL_API_VERSION: z.string().default('2021-07-28'),
  APP_BASE_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  WEBHOOK_SIGNING_SECRET: z.string().optional(),
})

export const env = envSchema.parse({
  GHL_CLIENT_ID: process.env.GHL_CLIENT_ID,
  GHL_CLIENT_SECRET: process.env.GHL_CLIENT_SECRET,
  GHL_APP_ID: process.env.GHL_APP_ID,
  GHL_API_BASE: process.env.GHL_API_BASE,
  GHL_API_VERSION: process.env.GHL_API_VERSION,
  APP_BASE_URL: process.env.APP_BASE_URL,
  DATABASE_URL: process.env.DATABASE_URL,
  DATABASE_SSL: process.env.DATABASE_SSL,
  WEBHOOK_SIGNING_SECRET: process.env.WEBHOOK_SIGNING_SECRET,
})

export const REDIRECT_URI = `${env.APP_BASE_URL}/api/oauth/callback`
