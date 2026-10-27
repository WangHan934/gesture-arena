import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { gzipSync, brotliCompressSync, constants as ZLIB } from 'node:zlib';
import { createBattle, castSpell, expireTurn, validMonster } from './src/pvp/engine.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const rooms = new Map();
const PORT = Number(process.env.PORT || 8000);
const IDLE_MS = 2 * 60 * 60 * 1000;
const token = () => randomBytes(24).toString('hex');
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

function snapshot(room) {
  return {
    id: room.id, phase: room.battle ? 'battle' : 'lobby',
    players: room.players.map(p => p && ({ name: p.name, monster: p.monster, ready: p.ready, online: p.streams.size > 0, rematch: p.rematch })),
    battle: room.battle, serverNow: Date.now(),
  };
}
function broadcast(room) {
  if (!room.battle && room.players.every(p => p?.ready && p.streams.size > 0)) {
    room.battle = createBattle(randomInt(2));
  }
  room.updated = Date.now();
  const data = `data: ${JSON.stringify(snapshot(room))}\n\n`;
  for (const player of room.players) for (const stream of player?.streams || []) stream.write(data);
}
/**
 * 找出这个请求属于哪个座位。
 *
 * 为什么不止读 Authorization：线上部署时前面有一层网关，
 * 它会把 Authorization 头吃掉，导致建房成功但后续请求全部 401。
 * 所以按可靠程度依次尝试四种携带方式（客户端全都会发）：
 *   1. 路径最后一段 /action/<token> —— 最可靠，路径一定会透传
 *   2. X-Ga-Token 头
 *   3. ?token= 查询参数
 *   4. Authorization: Bearer —— 本地直连的标准做法，保持优先兼容
 * 本地直连时 Authorization 仍然有效，行为不变。
 */
function member(req, room, url, pathToken = '') {
  const auth = req.headers.authorization;
  const token = pathToken
    || req.headers['x-ga-token']
    || url?.searchParams.get('token')
    || (auth?.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!token) return -1;
  return room.players.findIndex(p => p && p.token === token);
}
async function body(req) {
  let data = '';
  for await (const chunk of req) {
    data += chunk;
    if (data.length > 4096) throw new Error('请求过大');
  }
  return JSON.parse(data || '{}');
}
const nameOf = value => typeof value === 'string' ? value.trim().slice(0, 18) || '召唤师' : '召唤师';
function player(data) {
  return { token: token(), name: nameOf(data.name), monster: validMonster(data.monster) ? data.monster : 'fire', ready: false, rematch: false, streams: new Set() };
}
function newId() {
  let id;
  do { id = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(id));
  return id;
}
function destroyRoom(room) {
  for (const p of room.players) for (const s of p?.streams || []) s.end();
  rooms.delete(room.id);
}

/** Origin 是不是一个合法的来源（只挡畸形值，不比对主机名，原因见下面路由里的注释） */
function isParseableOrigin(origin) {
  try {
    return Boolean(new URL(origin).host);
  } catch {
    return false;
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json' };

/* ---------------- 静态资源：预压缩 + 内存缓存 + 304 ----------------
 *
 * 【为什么要自己压】
 *   线上网关不做压缩（实测响应里没有 Content-Encoding），而这个项目的首屏要拉
 *   three.core.js 1.5MB + 四个 GLB 2.8MB ≈ 5.2MB 明文。GLB 里没有贴图，
 *   全是顶点/骨骼的浮点数组，压缩率特别好：整体能压到 19% 左右，也就是 1MB 出头。
 *   手机上 4G 从 40 秒降到 8 秒，这是「加载很慢」最大的那一刀。
 *
 * 【为什么预压缩 + 缓存】
 *   原来每个请求都 readFile 一遍，压缩再放进去的话每次请求都要吃一次 CPU。
 *   这里按「路径 + mtime + 大小」缓存明文和两种压缩结果，文件一改缓存自动失效。
 *
 * 【为什么给 vendor / assets 长缓存】
 *   这两个目录是第三方库和模型，跟着发版才会变；给一天缓存，回访基本零下载。
 *   src/ 和 html 用 no-cache + ETag：每次回来问一句「变了吗」，没变就 304 空响应，
 *   改完代码刷新立刻生效，不会出现「用户还跑着旧代码」。
 */
const fileCache = new Map();
const CACHE_BUDGET = 64 * 1024 * 1024;
let cacheBytes = 0;

/** 这些后缀值得压；图片本身已压缩，压了反而更大 */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.glb', '.gltf', '.wasm', '.task']);
/** 太小就别压了，省下的字节还不如多出来的头 */
const COMPRESS_MIN = 1024;

async function loadStatic(file, ext) {
  const info = await stat(file);
  const cached = fileCache.get(file);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;

  const raw = await readFile(file);
  const entry = {
    mtimeMs: info.mtimeMs,
    size: info.size,
    raw,
    gzip: null,
    br: null,
    etag: `W/"${info.size.toString(16)}-${Math.round(info.mtimeMs).toString(16)}"`,
    compressible: COMPRESSIBLE.has(ext) && raw.length >= COMPRESS_MIN,
  };

  if (cached) cacheBytes -= cached.raw.length;
  else if (cacheBytes + raw.length > CACHE_BUDGET) {
    // 预算满了就整体清空重建，比维护 LRU 简单，而且这个项目的文件总数是固定的
    fileCache.clear();
    cacheBytes = 0;
  }
  fileCache.set(file, entry);
  cacheBytes += raw.length;
  return entry;
}

/** 按 Accept-Encoding 挑压缩方式，优先 brotli */
function pickEncoding(req, entry) {
  if (!entry.compressible) return null;
  const accept = String(req.headers['accept-encoding'] || '');
  if (/\bbr\b/.test(accept)) return 'br';
  if (/\bgzip\b/.test(accept)) return 'gzip';
  return null;
}

function encodedBody(entry, encoding) {
  if (encoding === 'br') {
    // 质量 5：比 gzip 再小 15%，压缩耗时又只有质量 11 的零头（而且只算一次）
    return entry.br ??= brotliCompressSync(entry.raw, {
      params: { [ZLIB.BROTLI_PARAM_QUALITY]: 5, [ZLIB.BROTLI_PARAM_SIZE_HINT]: entry.raw.length },
    });
  }
  if (encoding === 'gzip') return entry.gzip ??= gzipSync(entry.raw, { level: 6 });
  return entry.raw;
}

function cacheControlFor(relative) {
  if (/\.html$/.test(relative)) return 'no-cache';
  if (relative.startsWith('vendor/') || relative.startsWith('assets/')) return 'public, max-age=86400';
  return 'no-cache';
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      // 同源校验。
      // 【为什么不能拿 Origin 和 req.headers.host 硬比】
      //   线上部署前面有一层网关（CloudStudio Gateway），它会把 Host 改写成内部地址，
      //   于是 Origin（公网域名）永远和 Host 对不上 —— 浏览器一开房间就是 403，
      //   表现为「开房间用不了」。所以只在 Origin 畸形时拒绝。
      // 【为什么这样也够安全】
      //   跨站写请求带 Content-Type: application/json 会先触发 CORS 预检，
      //   本服务不响应 OPTIONS、也不发任何 Access-Control-* 头，浏览器直接拦掉；
      //   而身份校验靠房间 token（路径携带），拿到 token 才改得动房间。
      const origin = req.headers.origin;
      if (origin && !isParseableOrigin(origin)) return json(res, 403, { message: '请从游戏页面操作' });
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        if (rooms.size >= 500) return json(res, 503, { message: '房间已满，请稍后再试' });
        const data = await body(req);
        const id = newId();
        const p = player(data);
        const room = { id, players: [p, null], battle: null, updated: Date.now() };
        rooms.set(id, room);
        return json(res, 201, { roomId: id, seat: 0, token: p.token, state: snapshot(room) });
      }
      // 身份可以放在路径最后一段（/action/<token>）。线上网关会吃掉 Authorization 头，
      // 实测查询参数也到不了这里，只有路径是确定能透传的。
      const match = /^\/api\/rooms\/([A-F0-9]{6})\/(join|events|action)(?:\/([a-f0-9]{48}))?$/.exec(url.pathname);
      if (!match) return json(res, 404, { message: '接口不存在' });
      const room = rooms.get(match[1]);
      if (!room) return json(res, 404, { message: '房间不存在或已过期，请重新创建' });
      if (match[2] === 'join' && req.method === 'POST') {
        if (room.players[1]) return json(res, 409, { message: '房间已有两位玩家' });
        const p = player(await body(req));
        room.players[1] = p;
        broadcast(room);
        return json(res, 200, { roomId: room.id, seat: 1, token: p.token, state: snapshot(room) });
      }
      const seat = member(req, room, url, match[3]);
      if (seat < 0) return json(res, 401, { message: '房间身份失效，请重新加入' });
      const p = room.players[seat];
      if (match[2] === 'events' && req.method === 'GET') {
        // One active stream per seat: refresh replaces the stale connection.
        for (const stream of p.streams) stream.end();
        p.streams.clear();
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(': connected\n\n');
        p.streams.add(res);
        broadcast(room);
        req.on('close', () => { p.streams.delete(res); broadcast(room); });
        return;
      }
      if (match[2] === 'action' && req.method === 'POST') {
        const data = await body(req);
        let result = { ok: true };
        if (data.type === 'leave') {
          if (!room.battle) {
            destroyRoom(room);
            return json(res, 200, result);
          }
          if (room.battle && room.battle.winner === null) {
            room.battle.winner = 1 - seat;
            room.battle.log.push(`玩家 ${seat + 1} 离开了房间。`);
          }
          broadcast(room);
          for (const stream of p.streams) stream.end();
          p.streams.clear();
          // Never recycle a seat in a running match.
          if (!room.players.some(Boolean)) destroyRoom(room);
          else broadcast(room);
          return json(res, 200, result);
        }
        if (data.type === 'ready') {
          if (room.battle) return json(res, 409, { message: '对战已开始' });
          if (!validMonster(data.monster)) return json(res, 400, { message: '请选择怪兽' });
          p.monster = data.monster;
          p.ready = true;
        } else if (data.type === 'cast') {
          if (!room.battle) return json(res, 409, { message: '等待双方准备' });
          result = castSpell(room.battle, seat, data.spell);
        } else if (data.type === 'rematch') {
          if (!room.battle || room.battle.winner === null) return json(res, 409, { message: '本局还没结束' });
          p.rematch = true;
          if (room.players.every(q => q?.rematch && q.streams.size > 0)) {
            room.battle = null;
            for (const q of room.players) { q.ready = false; q.rematch = false; }
          }
        } else return json(res, 400, { message: '未知操作' });
        broadcast(room);
        return json(res, result.ok ? 200 : 409, result);
      }
      return json(res, 405, { message: '不支持的请求' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { message: '仅支持读取文件' });
    const pathname = decodeURIComponent(url.pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    // Serve the game only, never the checkout, private files, or server source.
    // classic.html 是单机版入口（塔防 / 决斗），solo.html 是人机对战，和 index.html 并列放在根目录。
    if (!/^(?:index|classic|solo)\.html$|^(?:src|vendor|assets|art\/renders)\/[^\0]+$/.test(relative) || relative.split('/').some(part => part.startsWith('.'))) return json(res, 404, { message: '文件不存在' });
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep) || !(await stat(file)).isFile()) return json(res, 404, { message: '文件不存在' });

    const ext = path.extname(file);
    const entry = await loadStatic(file, ext);
    const encoding = pickEncoding(req, entry);
    const etag = encoding ? `${entry.etag.slice(0, -1)}-${encoding}"` : entry.etag;

    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': cacheControlFor(relative),
      'ETag': etag,
      // 同一个 URL 有两种压缩版本，必须告诉缓存层
      'Vary': 'Accept-Encoding',
    };

    // 没变就只回一个空 304：回访时整页脚本、模型都不用重下
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }

    const payload = encodedBody(entry, encoding);
    if (encoding) headers['Content-Encoding'] = encoding;
    headers['Content-Length'] = payload.length;
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : payload);
  } catch (error) {
    if (res.headersSent) return res.end();
    json(res, error.code === 'ENOENT' ? 404 : 400, { message: error.code === 'ENOENT' ? '文件不存在' : '请求无效，请重试' });
  }
});

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const online = room.players.some(p => p?.streams.size);
    if (!online && now - room.updated > IDLE_MS) { destroyRoom(room); continue; }
    if (room.battle && expireTurn(room.battle, now)) broadcast(room);
    for (const p of room.players) for (const stream of p?.streams || []) stream.write(': heartbeat\n\n');
  }
}, 1000).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n怪兽 PvP 已启动：http://localhost:${server.address().port}`);
  for (const list of Object.values(networkInterfaces())) for (const address of list || []) {
    if (address.family === 'IPv4' && !address.internal) console.log(`同一 Wi-Fi 的另一台设备打开：http://${address.address}:${server.address().port}`);
  }
  console.log('两台设备跨网络对战：把项目部署到支持 Node.js 常驻服务的 HTTPS 主机。\n');
});
