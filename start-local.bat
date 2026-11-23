@echo off
rem 이 PC(d:\AUTOJIRA) 에서 국내 지라 도구를 혼자 띄운다 — http://localhost:3000
rem 지라 자격은 .pmagent\config\credentials.json 의 jira.token 에 넣는다 (git 에 안 올라감).
cd /d "%~dp0"
set PM_AGENT_DIR=%~dp0.pmagent
node server.js
