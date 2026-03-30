const fs = require('fs')
const path = require('path')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  const result = {}
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    result[key] = val
  }
  return result
}

module.exports = {
  apps: [
    {
      name: 'ai-agent-orchestrator',
      script: 'dist/index.js',
      interpreter: 'node',
      cwd: __dirname,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      restart_delay: 3000,
      max_restarts: 10,
      autorestart: true,
      env: loadEnvFile(path.join(__dirname, '.env')),
    },
  ],
}
