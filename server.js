const express = require('express');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// CORS 허용 (GitHub Pages 등 외부에서 접근)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Jira-Domain,X-Jira-Auth');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

// 정적 파일 (로컬 접속용) — 화면이 쓰는 파일만 내보낸다.
// 폴더 통째로 열면 config.json · move-logs/ · server.js 까지 주소로 읽힌다.
app.get(['/', '/index.html'], (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
['lib/logger.js', 'lib/utils.js', 'lib/subtask-move.js'].forEach(f => {
    app.get('/' + f, (req, res) => res.sendFile(path.join(__dirname, f)));
});
app.use(express.json({ strict: false }));

// 설정 파일 경로
const CONFIG_PATH = path.join(__dirname, 'config.json');

/* ── 지라 자격은 PM AGENT 의 연결 설정 한 군데서 온다 ──────────────
   베껴 두지 않고 그때그때 읽는다. 파일 고친 시각이 그대로면 읽지 않는다.
   PM AGENT 가 없는 PC 에서 혼자 띄울 때를 위해 환경변수도 본다. */
const PM_AGENT = process.env.PM_AGENT_DIR || path.join('E:', 'PM-AGENT');
const 자격파일 = path.join(PM_AGENT, 'config', 'credentials.json');
let _자격 = null, _읽은때 = 0;

function 지라자격() {
    const env = {
        domain: process.env.JIRA_DOMAIN || '',
        email: process.env.JIRA_EMAIL || '',
        token: process.env.JIRA_API_TOKEN || '',
    };
    if (env.email && env.token) return { ...env, 어디서: '환경변수' };
    try {
        const 때 = require('fs').statSync(자격파일).mtimeMs;
        if (!_자격 || 때 !== _읽은때) {
            const j = (JSON.parse(require('fs').readFileSync(자격파일, 'utf8')) || {}).jira || {};
            _자격 = {
                domain: j.domain || env.domain || '',
                email: j.email || '',
                token: j.token || '',
                어디서: 'PM AGENT 연결 설정',
            };
            _읽은때 = 때;
        }
        return _자격;
    } catch (e) {
        return { ...env, 어디서: '', 탈: String(e.message).slice(0, 120) };
    }
}

/* 화면이 "누구로 들어가 있는지" 를 묻는 자리. 토큰은 절대 안 싣는다. */
app.get('/api/me', (req, res) => {
    const c = 지라자격();
    res.json({
        ok: Boolean(c.email && c.token),
        domain: c.domain,
        email: c.email,
        어디서: c.어디서,
        탈: c.탈 || '',
    });
});

// 설정 읽기
app.get('/api/config', (req, res) => {
    try {
        if (require('fs').existsSync(CONFIG_PATH)) {
            const data = require('fs').readFileSync(CONFIG_PATH, 'utf8');
            res.json(JSON.parse(data));
        } else {
            res.json({});
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* 프리셋 합치기는 화면과 같은 함수를 쓴다 (lib/utils.js).
   이름으로 짝지어 나중에 고친 쪽을 두고, '지운 표'(jiraPresetsDeleted) 에
   적힌 이름은 지운 시각보다 나중에 고친 것이 아니면 뺀다. 전에는 지운 것을
   나타낼 길이 없어서 지우거나 이름을 바꾼 프리셋이 다시 열면 되살아났다. */
const { reconcilePresets } = require('./lib/utils.js');

// 설정 저장 (개인 토큰·이메일은 서버에 저장하지 않음 — 다중 사용자 덮어쓰기 방지)
// 프리셋은 서버에 저장하되, 기존 프리셋과 병합 (이름 중복 시 updatedAt 최신값 유지, 지운 표 반영)
app.post('/api/config', (req, res) => {
    try {
        const fs = require('fs');
        const body = req.body || {};

        // 개인 필드 필터링
        delete body.jiraToken;
        delete body.jiraEmail;

        // 기존 config 읽어서 프리셋 병합
        let existing = {};
        if (fs.existsSync(CONFIG_PATH)) {
            try {
                existing = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
            } catch (e) {
                existing = {};
            }
        }

        // 프리셋 병합 (기존 + 새 프리셋, 중복은 최신버전만, 지운 표에 있는 것은 뺀다)
        if (body.jiraPresets || existing.jiraPresets || body.jiraPresetsDeleted || existing.jiraPresetsDeleted) {
            const r = reconcilePresets({
                presets: [existing.jiraPresets || [], Array.isArray(body.jiraPresets) ? body.jiraPresets : []],
                deleted: [existing.jiraPresetsDeleted || [], Array.isArray(body.jiraPresetsDeleted) ? body.jiraPresetsDeleted : []],
            });
            body.jiraPresets = r.presets;
            body.jiraPresetsDeleted = r.deleted;
        }

        /* 보내 온 것만 쓰고 나머지를 버리면, 화면이 안 보내는 설정이 조용히
           사라진다. 프리셋만 저장했을 뿐인데 proxyUrl 이 날아갔다
           (2026-10-19). 있던 것 위에 덮어쓴다. */
        const merged = { ...existing, ...body };
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 서브태스크 이동 로그 (원래 부모 기록 → undo 용)
const MOVE_LOG_DIR = path.join(__dirname, 'move-logs');
const MOVE_LOG_ID = /^move-[0-9A-Za-z-]+$/;

app.post('/api/move-log', (req, res) => {
    try {
        const fs = require('fs');
        const entry = req.body || {};
        if (!MOVE_LOG_ID.test(entry.id || '')) return res.status(400).json({ error: 'invalid id' });
        fs.mkdirSync(MOVE_LOG_DIR, { recursive: true });
        fs.writeFileSync(path.join(MOVE_LOG_DIR, entry.id + '.json'), JSON.stringify(entry, null, 2), 'utf8');
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/move-log', (req, res) => {
    try {
        const fs = require('fs');
        if (!fs.existsSync(MOVE_LOG_DIR)) return res.json([]);
        // 깨진 파일 하나 때문에 목록 전체(되돌리기)가 막히지 않게, 못 읽는 파일은 건너뛰고 알린다
        const list = [];
        for (const f of fs.readdirSync(MOVE_LOG_DIR).filter(f => f.endsWith('.json')).sort().reverse()) {
            if (list.length >= 20) break;
            try {
                list.push(JSON.parse(fs.readFileSync(path.join(MOVE_LOG_DIR, f), 'utf8')));
            } catch (e) {
                console.warn('[move-log] 읽을 수 없는 로그 건너뜀:', f, e.message);
            }
        }
        res.json(list);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Jira API 프록시 - 첨부파일용 raw body 처리
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

app.use('/jira-proxy', (req, res, next) => {
    // 첨부파일 요청은 multer로 처리
    if (req.url.includes('/attachments') && req.method === 'POST') {
        upload.single('file')(req, res, next);
    } else {
        next();
    }
}, async (req, res) => {
    const jiraPath = req.url;

    /* 서버가 들고 있는 자격이 먼저다. 화면에서 보내 온 머리글은 PM AGENT 가
       없는 PC 에서 혼자 띄웠을 때만 쓴다 — 브라우저에 남아 있던 옛 토큰이
       서버 것을 밀어내면 안 된다. */
    const 내자격 = 지라자격();
    const domain = (내자격.email && 내자격.token && 내자격.domain)
        || req.headers['x-jira-domain'];
    const auth = (내자격.email && 내자격.token)
        ? Buffer.from(내자격.email + ':' + 내자격.token).toString('base64')
        : req.headers['x-jira-auth'];

    if (!domain || !auth) {
        return res.status(400).json({
            error: '지라 자격이 없습니다. PM AGENT ▸ 시스템 ▸ 연결 설정 에서 지라 도메인·이메일·API 토큰을 넣어 주세요.',
        });
    }

    const url = `https://${domain}${jiraPath}`;

    try {
        let fetchOptions;

        if (req.file) {
            // 첨부파일 업로드 (multipart)
            const form = new FormData();
            form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
            fetchOptions = {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Accept': 'application/json',
                    'X-Atlassian-Token': 'no-check'
                },
                body: form
            };
        } else {
            fetchOptions = {
                method: req.method,
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            };

            if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
                fetchOptions.body = JSON.stringify(req.body);
            }
        }

        const response = await fetch(url, fetchOptions);
        const data = await response.text();

        res.status(response.status);
        const ct = response.headers.get('content-type');
        if (ct) res.setHeader('Content-Type', ct);
        res.send(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* 이 PC 안에서만 듣는다. 서버가 내 토큰을 끼워 넣으므로, 같은 망의 누가
   열면 내 이름으로 티켓이 만들어진다. PM AGENT 의 프록시는 127.0.0.1 로
   들어오니 쓰는 데는 지장이 없다. */
app.listen(PORT, '127.0.0.1', () => {
    const c = 지라자격();
    console.log('');
    console.log('  국내 지라 도구 (KR JIRA)  http://127.0.0.1:' + PORT);
    console.log('  지라 자격: ' + (c.email && c.token ? c.email + ' — ' + c.어디서 : '없음 (PM AGENT ▸ 연결 설정)'));
    console.log('');
});
