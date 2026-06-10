const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

function readApiKey() {
    const env = fs.readFileSync(path.join(__dirname, 'claude_key.env'), 'utf8');
    for (const line of env.split('\n')) {
        const [key, ...val] = line.split('=');
        if (key.trim() === 'ANTHROPIC_API_KEY') return val.join('=').trim();
    }
    throw new Error('ANTHROPIC_API_KEY not found in claude_key.env');
}

const ANTHROPIC_API_KEY = readApiKey();
const PORT = 3001;
const STATIC_DIR = __dirname;

const MIME = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.ply':  'application/octet-stream',
    '.json': 'application/json',
    '.env':  'text/plain',
};

function serveStatic(req, res) {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(STATIC_DIR, urlPath === '/' ? 'index.html' : urlPath);

    // Block access to the env/key file from the browser
    if (filePath.endsWith('.env')) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found: ' + urlPath);
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
            'Content-Type': MIME[ext] || 'application/octet-stream',
            'Content-Length': stat.size,
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

function handleClaudeProxy(req, res) {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
        const postData = body;
        const options = {
            hostname: 'api.anthropic.com',
            path: '/v1/messages',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
        };

        const proxyReq = https.request(options, proxyRes => {
            res.writeHead(proxyRes.statusCode, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            });
            proxyRes.pipe(res);
        });

        proxyReq.on('error', err => {
            console.error('Proxy error:', err.message);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
        });

        proxyReq.write(postData);
        proxyReq.end();
    });
}

const server = http.createServer((req, res) => {
    console.log(req.method, req.url);

    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST',
            'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
    }

    if (req.method === 'POST' && req.url === '/api/claude') {
        handleClaudeProxy(req, res);
    } else if (req.method === 'GET') {
        serveStatic(req, res);
    } else {
        res.writeHead(405);
        res.end('Method not allowed');
    }
});

server.listen(PORT, () => {
    console.log(`Jaffa Annotations server running at http://localhost:${PORT}`);
    console.log('ANTHROPIC_API_KEY loaded:', ANTHROPIC_API_KEY ? 'YES' : 'NO');
});
