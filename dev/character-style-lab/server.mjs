import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const labRoot = path.dirname(fileURLToPath(import.meta.url));
const gameJsRoot = path.resolve(labRoot, '../../js');
const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.gif':'image/gif', '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.txt':'text/plain; charset=utf-8' };
http.createServer(async (req, res) => {
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405,{Allow:'GET, HEAD'}).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname);
    const gameModule = pathname.startsWith('/game/');
    const base = gameModule ? gameJsRoot : labRoot;
    const route = gameModule ? pathname.slice('/game'.length) : pathname;
    const pageRoute = route === '/' ? (gameModule ? '/index.html' : '/sprite-lab.html') : route;
    const file = path.resolve(base, `.${pageRoute}`);
    if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type':mime[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length':data.length, 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    res.writeHead(error?.code === 'ENOENT' ? 404 : 400, { 'Content-Type':'text/plain; charset=utf-8' });
    res.end(error?.code === 'ENOENT' ? 'Not found' : 'Bad request');
  }
}).listen(Number(process.env.PORT || 4173), '0.0.0.0', () => console.log(`Character style lab on 0.0.0.0:${process.env.PORT || 4173}`));
