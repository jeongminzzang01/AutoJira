// PM2 ecosystem file — AUTOJIRA + ResourceLite 통합 관리
// 사용: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'autojira',
      script: './server.js',
      cwd: 'd:/AUTOJIRA',
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 2000,
      max_memory_restart: '500M',
      out_file: 'd:/AUTOJIRA/pm2.out.log',
      error_file: 'd:/AUTOJIRA/pm2.err.log',
      merge_logs: true,
      time: true,
      env: { PORT: '3000', NODE_ENV: 'production' }
    },
    {
      name: 'resourcelite',
      script: './server.js',
      cwd: 'd:/ResourceLite',
      autorestart: true,
      watch: false,
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 2000,
      max_memory_restart: '300M',
      out_file: 'd:/ResourceLite/pm2.out.log',
      error_file: 'd:/ResourceLite/pm2.err.log',
      merge_logs: true,
      time: true,
      env: { PORT: '3100', NODE_ENV: 'production' }
    }
  ]
};
