import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt } from 'node:crypto';
import { networkInterfaces } from 'node:os';
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
function member(req, room) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return -1;
  return room.players.findIndex(p => p && p.token === auth.slice(7));
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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json' };

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      // Same-origin browser mutations only. No permissive CORS.
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, { message: '请从游戏页面操作' });
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        if (rooms.size >= 500) return json(res, 503, { message: '房间已满，请稍后再试' });
        const data = await body(req);
        const id = newId();
        const p = player(data);
        const room = { id, players: [p, null], battle: null, updated: Date.now() };
        rooms.set(id, room);
        return json(res, 201, { roomId: id, seat: 0, token: p.token, state: snapshot(room) });
      }
      const match = /^\/api\/rooms\/([A-F0-9]{6})\/(join|events|action)$/.exec(url.pathname);
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
      const seat = member(req, room);
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
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : bytes);
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
