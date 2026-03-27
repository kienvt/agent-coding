import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { Hono } from 'hono'
import { serveStatic } from '@hono/node-server/serve-static'

export function registerStaticRoutes(app: Hono): void {
  const isProd = process.env['NODE_ENV'] === 'production'
  // Dev: serve from public-dist/ (built by Vite) or fall back to legacy public/
  // Prod: serve from dist/public-dist/
  const candidates = isProd
    ? ['./dist/public-dist', './public-dist']
    : ['./public-dist']

  const relativeRoot = candidates.find((p) => existsSync(join(process.cwd(), p)))
  if (!relativeRoot) return

  app.use('/*', serveStatic({ root: relativeRoot }))
}
