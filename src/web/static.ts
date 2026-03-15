import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'

export function registerStaticRoutes(app: Hono): void {
  const isProd = process.env['NODE_ENV'] === 'production'
  const relativeRoot = isProd ? './dist/web/public' : './src/web/public'
  const publicDir = join(process.cwd(), isProd ? 'dist/web/public' : 'src/web/public')
  if (!existsSync(publicDir)) return

  app.use('/*', serveStatic({ root: relativeRoot }))
}
