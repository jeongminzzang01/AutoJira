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

// 정적 파일 (로컬 접속용)
app.use(express.static(path.join(__dirname)));
app.use(express.json({ strict: false }));

// 설정 파일 경로
const CONFIG_PATH = path.join(__dirname, 'config.json');

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

// 프리셋 병합: 같은 이름이면 updatedAt 기준 최신값만 유지
function mergePresets(existing = [], incoming = []) {
    const map = {};
    existing.forEach(p => {
        const key = p.name || '';
        if (!map[key] || (p.updatedAt || 0) > (map[key].updatedAt || 0)) {
            map[key] = p;
        }
    });
    incoming.forEach(p => {
        const key = p.name || '';
        if (!map[key] || (p.updatedAt || 0) > (map[key].updatedAt || 0)) {
            map[key] = p;
        }
    });
    return Object.values(map);
}

// 설정 저장 (개인 토큰·이메일은 서버에 저장하지 않음 — 다중 사용자 덮어쓰기 방지)
// 프리셋은 서버에 저장하되, 기존 프리셋과 병합 (이름 중복 시 updatedAt 최신값 유지)
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

        // 프리셋 병합 (기존 + 새 프리셋, 중복은 최신버전만)
        if (body.jiraPresets || existing.jiraPresets) {
            body.jiraPresets = mergePresets(existing.jiraPresets || [], body.jiraPresets || []);
        }

        fs.writeFileSync(CONFIG_PATH, JSON.stringify(body, null, 2), 'utf8');
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
        const list = fs.readdirSync(MOVE_LOG_DIR).filter(f => f.endsWith('.json')).sort().reverse().slice(0, 20)
            .map(f => JSON.parse(fs.readFileSync(path.join(MOVE_LOG_DIR, f), 'utf8')));
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
    const domain = req.headers['x-jira-domain'];
    const auth = req.headers['x-jira-auth'];

    if (!domain || !auth) {
        return res.status(400).json({ error: 'Missing Jira domain or auth' });
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

app.listen(PORT, '0.0.0.0', () => {
    const os = require('os');
    const nets = os.networkInterfaces();
    let ip = 'localhost';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) { ip = net.address; break; }
        }
    }
    console.log('');
    console.log('  ✅ AUTOJIRA 프록시 서버 실행 중');
    console.log(`  로컬:    http://localhost:${PORT}`);
    console.log(`  네트워크: http://${ip}:${PORT}`);
    console.log('');
});
