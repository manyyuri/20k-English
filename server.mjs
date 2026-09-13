// server.mjs — 零依赖本地服务器：静态文件 + /api/pi-llm（运行时读 ~/.pi/agent/models.json）
// 用法：node server.mjs [port]   （默认 8787，只绑 127.0.0.1）
// key 只在内存里过一手，不落仓库；浏览器侧同源才能取到。
import { createServer } from 'node:http';
import { readFile, stat, unlink } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { homedir } from 'node:os';

const PORT = Number(process.argv[2] || 8787);
const ROOT = new URL('.', import.meta.url).pathname;
const PI_MODELS = join(homedir(), '.pi', 'agent', 'models.json');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};

// ---- /api/pi-llm：只挑我们的适配层会说的 openai-completions 供应商 ----
async function piLlm() {
  let cfg;
  try { cfg = JSON.parse(await readFile(PI_MODELS, 'utf8')); } catch { return null; }
  const providers = [];
  for (const [id, p] of Object.entries(cfg.providers || {})) {
    if (!p.baseUrl || !p.apiKey) continue;
    if (p.api && p.api !== 'openai-completions') continue; // responses/anthropic 协议不认
    providers.push({
      id,
      baseUrl: p.baseUrl.replace(/\/+$/, ''),
      apiKey: p.apiKey,
      models: (p.models || []).map((m) => ({ id: m.id, name: m.name || m.id })),
    });
  }
  // glm 优先（用户主用），其次 moonshot/zhipu，最后按原顺序
  providers.sort((a, b) => pref(b.id) - pref(a.id));
  return { providers };
}
const pref = (id) => ({ glm: 3, moonshot: 2, zhipu: 1 }[id.toLowerCase()] || 0);

async function serveFile(res, filepath) {
  try {
    const data = await readFile(filepath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filepath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found');
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === '/api/pi-llm') {
    const data = await piLlm();
    if (!data) { res.writeHead(502, { 'Content-Type': 'application/json' }); res.end('{"error":"cannot read ~/.pi/agent/models.json"}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
    return;
  }
  // 收件箱：agent 在终端收割的语块 → app 打开后一键入库（DELETE 清空）
  if (url.pathname === '/api/inbox') {
    if (req.method === 'GET') {
      let text = '{"chunks":[]}';
      try { text = await readFile(join(ROOT, 'inbox.json'), 'utf8'); } catch { }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(text);
    } else if (req.method === 'DELETE') {
      try { await unlink(join(ROOT, 'inbox.json')); } catch { }
      res.writeHead(204); res.end();
    } else { res.writeHead(405); res.end(); }
    return;
  }
  // 静态：目录 → index.html；防穿越
  let p = normalize(join(ROOT, decodeURIComponent(url.pathname)));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  try { if ((await stat(p)).isDirectory()) p = join(p, 'index.html'); } catch { /* 404 由 readFile 兜 */ }
  await serveFile(res, p);
}).listen(PORT, '127.0.0.1', () => {
  console.log(`en20k → http://localhost:${PORT}  (pi 桥: /api/pi-llm)`);
});
