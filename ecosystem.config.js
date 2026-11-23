/* PM AGENT 안에서 'KR JIRA' 로 쓰는 국내 지라 도구.
   포트 3004 — pmtool(3001) · leaveboard(3003) 와 겹치지 않는 자리다. */
module.exports = {
  apps: [{
    name: 'autojira',
    script: 'server.js',
    cwd: __dirname,
    env: { PORT: 3004 },
    autorestart: true,
    max_memory_restart: '300M',
  }],
};
