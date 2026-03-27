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
    },
  ],
}
