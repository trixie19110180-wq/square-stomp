import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import crypto from 'crypto';

const PORT = Number(process.env.PORT || 3000);
const TICK_RATE = 60;
const BROADCAST_RATE = 30;
const ARENA = { width: 3600, height: 720 };
const PLAYER_SIZE = 42;
const GRAVITY = 2300;
const MOVE_ACCEL = 3000;
const MAX_SPEED_X = 460;
const JUMP_SPEED = 820;
const FRICTION = 0.82;
const RESPAWN_INVULN_MS = 900;
const STOMP_COOLDOWN_MS = 350;
const PLATFORMS = [
  { x: 0, y: 680, width: 3600, height: 40 },
  { x: 220, y: 560, width: 260, height: 26 },
  { x: 620, y: 480, width: 230, height: 26 },
  { x: 1030, y: 590, width: 290, height: 26 },
  { x: 1430, y: 430, width: 260, height: 26 },
  { x: 1780, y: 540, width: 300, height: 26 },
  { x: 2220, y: 465, width: 260, height: 26 },
  { x: 2580, y: 595, width: 320, height: 26 },
  { x: 3060, y: 500, width: 260, height: 26 }
];

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

/** @type {Map<string, import('ws').WebSocket>} */
const sockets = new Map();
/** @type {Map<string, Player>} */
const players = new Map();

/**
 * @typedef {object} Player
 * @property {string} id
 * @property {string} username
 * @property {string} color
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} prevX
 * @property {number} prevY
 * @property {number} score
 * @property {boolean} grounded
 * @property {{left: boolean, right: boolean, jump: boolean}} input
 * @property {number} lastStompAt
 * @property {number} invulnerableUntil
 */

app.use(express.static('public'));

app.get('/api/username/:username', (req, res) => {
  const username = normalizeUsername(req.params.username);
  if (!username) {
    return res.status(400).json({ available: false, reason: 'Use 2-16 letters, numbers, spaces, underscores, or hyphens.' });
  }

  res.json({ available: !isUsernameTaken(username) });
});

wss.on('connection', (socket) => {
  const id = crypto.randomUUID();
  sockets.set(id, socket);

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return send(socket, { type: 'error', message: 'Invalid message format.' });
    }

    if (message?.type === 'join') {
      handleJoin(id, socket, message);
      return;
    }

    if (message?.type === 'input') {
      handleInput(id, message);
    }
  });

  socket.on('close', () => removePlayer(id));
  socket.on('error', () => removePlayer(id));
});

function handleJoin(id, socket, message) {
  if (players.has(id)) {
    return;
  }

  const username = normalizeUsername(message.username);
  const color = normalizeColor(message.color);

  if (!username) {
    return send(socket, { type: 'joinRejected', reason: 'Use 2-16 letters, numbers, spaces, underscores, or hyphens.' });
  }

  if (isUsernameTaken(username)) {
    return send(socket, { type: 'joinRejected', reason: 'That username is already active.' });
  }

  if (!color) {
    return send(socket, { type: 'joinRejected', reason: 'Use a valid hex, rgb(), or rgba() color.' });
  }

  const spawn = getSpawnPoint();
  players.set(id, {
    id,
    username,
    color,
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    prevX: spawn.x,
    prevY: spawn.y,
    score: 0,
    grounded: false,
    input: { left: false, right: false, jump: false },
    lastStompAt: 0,
    invulnerableUntil: Date.now() + RESPAWN_INVULN_MS
  });

  send(socket, { type: 'joined', id, arena: ARENA, size: PLAYER_SIZE, platforms: PLATFORMS });
  broadcastSystem(`${username} joined`);
  broadcastState();
}

function handleInput(id, message) {
  const player = players.get(id);
  if (!player) {
    return;
  }

  player.input = {
    left: Boolean(message.input?.left),
    right: Boolean(message.input?.right),
    jump: Boolean(message.input?.jump)
  };
}

function removePlayer(id) {
  const player = players.get(id);
  sockets.delete(id);

  if (player) {
    players.delete(id);
    broadcastSystem(`${player.username} left`);
    broadcastState();
  }
}

function update(dt) {
  const now = Date.now();

  for (const player of players.values()) {
    player.prevX = player.x;
    player.prevY = player.y;

    const direction = Number(player.input.right) - Number(player.input.left);
    player.vx += direction * MOVE_ACCEL * dt;
    player.vx = clamp(player.vx, -MAX_SPEED_X, MAX_SPEED_X);

    if (!direction) {
      player.vx *= FRICTION;
      if (Math.abs(player.vx) < 4) player.vx = 0;
    }

    if (player.input.jump && player.grounded) {
      player.vy = -JUMP_SPEED;
      player.grounded = false;
    }

    player.x += player.vx * dt;
    resolveWorldX(player);
    resolvePlatformHorizontal(player);

    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;
    player.grounded = false;
    resolveWorldY(player);
    resolvePlatformVertical(player);
  }

  resolvePlayerCollisions(now);
}

function resolveWorldX(player) {
  if (player.x < 0) {
    player.x = 0;
    player.vx = 0;
  }

  if (player.x + PLAYER_SIZE > ARENA.width) {
    player.x = ARENA.width - PLAYER_SIZE;
    player.vx = 0;
  }
}

function resolveWorldY(player) {
  if (player.y + PLAYER_SIZE >= ARENA.height) {
    player.y = ARENA.height - PLAYER_SIZE;
    player.vy = 0;
    player.grounded = true;
  }

  if (player.y < 0) {
    player.y = 0;
    player.vy = Math.max(0, player.vy);
  }
}

function resolvePlatformHorizontal(player) {
  for (const platform of PLATFORMS) {
    if (!rectsOverlap(player.x, player.y, PLAYER_SIZE, PLAYER_SIZE, platform.x, platform.y, platform.width, platform.height)) {
      continue;
    }

    const wasRightOfPlatform = player.prevX >= platform.x + platform.width;
    const wasLeftOfPlatform = player.prevX + PLAYER_SIZE <= platform.x;

    if (wasLeftOfPlatform && player.vx > 0) {
      player.x = platform.x - PLAYER_SIZE;
      player.vx = 0;
    } else if (wasRightOfPlatform && player.vx < 0) {
      player.x = platform.x + platform.width;
      player.vx = 0;
    }
  }
}

function resolvePlatformVertical(player) {
  for (const platform of PLATFORMS) {
    if (!rectsOverlap(player.x, player.y, PLAYER_SIZE, PLAYER_SIZE, platform.x, platform.y, platform.width, platform.height)) {
      continue;
    }

    const previousBottom = player.prevY + PLAYER_SIZE;
    const previousTop = player.prevY;
    const platformBottom = platform.y + platform.height;

    if (previousBottom <= platform.y && player.vy >= 0) {
      player.y = platform.y - PLAYER_SIZE;
      player.vy = 0;
      player.grounded = true;
    } else if (previousTop >= platformBottom && player.vy < 0) {
      player.y = platformBottom;
      player.vy = 0;
    }
  }
}

function resolvePlayerCollisions(now) {
  const list = [...players.values()];

  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const a = list[i];
      const b = list[j];

      if (!overlaps(a, b)) {
        continue;
      }

      const aStompsB = isStomp(a, b, now);
      const bStompsA = isStomp(b, a, now);

      if (aStompsB && !bStompsA) {
        awardStomp(a, b, now);
      } else if (bStompsA && !aStompsB) {
        awardStomp(b, a, now);
      } else {
        separateHorizontally(a, b);
      }
    }
  }
}

function isStomp(attacker, target, now) {
  const attackerBottomBefore = attacker.prevY + PLAYER_SIZE;
  const targetTopBefore = target.prevY;
  const horizontalOverlap = attacker.x < target.x + PLAYER_SIZE && attacker.x + PLAYER_SIZE > target.x;

  return (
    horizontalOverlap &&
    attacker.vy > 120 &&
    attackerBottomBefore <= targetTopBefore + 14 &&
    now > target.invulnerableUntil &&
    now - attacker.lastStompAt > STOMP_COOLDOWN_MS
  );
}

function awardStomp(attacker, target, now) {
  attacker.score += 1;
  attacker.vy = -JUMP_SPEED * 0.55;
  attacker.lastStompAt = now;

  const spawn = getSpawnPoint(target.id);
  target.x = spawn.x;
  target.y = spawn.y;
  target.prevX = spawn.x;
  target.prevY = spawn.y;
  target.vx = 0;
  target.vy = 0;
  target.grounded = false;
  target.invulnerableUntil = now + RESPAWN_INVULN_MS;

  broadcast({
    type: 'event',
    event: 'stomp',
    attackerId: attacker.id,
    attacker: attacker.username,
    targetId: target.id,
    target: target.username
  });
}

function separateHorizontally(a, b) {
  const aCenter = a.x + PLAYER_SIZE / 2;
  const bCenter = b.x + PLAYER_SIZE / 2;
  const overlap = PLAYER_SIZE - Math.abs(aCenter - bCenter);
  const push = Math.max(1, overlap / 2);

  if (aCenter <= bCenter) {
    a.x = clamp(a.x - push, 0, ARENA.width - PLAYER_SIZE);
    b.x = clamp(b.x + push, 0, ARENA.width - PLAYER_SIZE);
  } else {
    a.x = clamp(a.x + push, 0, ARENA.width - PLAYER_SIZE);
    b.x = clamp(b.x - push, 0, ARENA.width - PLAYER_SIZE);
  }

  a.vx *= -0.25;
  b.vx *= -0.25;
}

function broadcastState() {
  broadcast({
    type: 'state',
    players: [...players.values()].map((player) => ({
      id: player.id,
      username: player.username,
      color: player.color,
      x: round(player.x),
      y: round(player.y),
      score: player.score,
      invulnerable: Date.now() < player.invulnerableUntil
    }))
  });
}

function broadcastSystem(message) {
  broadcast({ type: 'event', event: 'system', message });
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const socket of sockets.values()) {
    if (socket.readyState === socket.OPEN) {
      socket.send(data);
    }
  }
}

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function getSpawnPoint(skipId = '') {
  const spawnPlatforms = PLATFORMS.filter((platform) => platform.width >= PLAYER_SIZE * 2);
  const attempts = 60;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const platform = spawnPlatforms[randomInt(0, spawnPlatforms.length - 1)];
    const point = {
      x: randomInt(platform.x + PLAYER_SIZE, platform.x + platform.width - PLAYER_SIZE * 2),
      y: platform.y - PLAYER_SIZE
    };

    const tooClose = [...players.values()].some((player) => (
      player.id !== skipId &&
      Math.hypot(player.x - point.x, player.y - point.y) < PLAYER_SIZE * 2.2
    ));

    if (!tooClose) {
      return point;
    }
  }

  return {
    x: PLAYER_SIZE,
    y: PLATFORMS[0].y - PLAYER_SIZE
  };
}

function isUsernameTaken(username) {
  const key = username.toLowerCase();
  return [...players.values()].some((player) => player.username.toLowerCase() === key);
}

function normalizeUsername(value) {
  const username = String(value || '').trim().replace(/\s+/g, ' ');
  if (!/^[a-zA-Z0-9 _-]{2,16}$/.test(username)) {
    return '';
  }
  return username;
}

function normalizeColor(value) {
  const color = String(value || '').trim();
  const hex = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const rgb = /^rgba?\(\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+))?\s*\)$/i;

  if (hex.test(color) || rgb.test(color)) {
    return color;
  }

  return '';
}

function overlaps(a, b) {
  return rectsOverlap(a.x, a.y, PLAYER_SIZE, PLAYER_SIZE, b.x, b.y, PLAYER_SIZE, PLAYER_SIZE);
}

function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

setInterval(() => update(1 / TICK_RATE), 1000 / TICK_RATE);
setInterval(broadcastState, 1000 / BROADCAST_RATE);

server.listen(PORT, () => {
  console.log(`Square Stomp running on http://localhost:${PORT}`);
});
