// ecosystem.config.js
module.exports = {
    apps: [{
      name: 'MonitorX',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,                     // We don't want PM2 to restart on file changes (nodemon handles dev)
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_file: './logs/pm2-combined.log',
      time: true,
      kill_timeout: 5000,               // Allow graceful shutdown (DB close, Playwright context cleanup)
      wait_ready: true,
      listen_timeout: 10000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      max_restarts: 10,
      min_uptime: 5000,
    }]
  };