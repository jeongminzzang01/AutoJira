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
app.use(express.json());

// Jira API 프록시
app.use('/jira-proxy', async (req, res) => {
    const jiraPath = req.url;
    const domain = req.headers['x-jira-domain'];
    const auth = req.headers['x-jira-auth'];

    if (!domain || !auth) {
        return res.status(400).json({ error: 'Missing Jira domain or auth' });
    }

    const url = `https://${domain}${jiraPath}`;

    try {
        const fetchOptions = {
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
