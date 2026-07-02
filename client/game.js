const landing = document.querySelector('#landing');
const game = document.querySelector('#game');
const joinForm = document.querySelector('#joinForm');
const usernameInput = document.querySelector('#username');
const nativeColorInput = document.querySelector('#nativeColor');
const colorInput = document.querySelector('#color');
const adminFields = document.querySelector('#adminFields');
const adminPassphraseInput = document.querySelector('#adminPassphrase');
const adminCodeInput = document.querySelector('#adminCode');
const secretToggleButtons = document.querySelectorAll('.secret-toggle');
const startButton = document.querySelector('#startButton');
const joinError = document.querySelector('#joinError');
const canvas = document.querySelector('#arena');
const ctx = canvas.getContext('2d');
const connectionStatus = document.querySelector('#connectionStatus');
const playerCount = document.querySelector('#playerCount');
const coordinates = document.querySelector('#coordinates');
const fpsStatus = document.querySelector('#fpsStatus');
const shockStatus = document.querySelector('#shockStatus');
const scoreboard = document.querySelector('#scoreboard');
const toast = document.querySelector('#toast');
const loadingScreen = document.querySelector('#loadingScreen');

const PLAYER_SIZE = 42;
const state = {
  socket: null,
  localId: '',
  arena: { width: 3600, height: 720 },
  platforms: [],
  shockwave: { cooldownMs: 4000, radius: 260 },
  players: new Map(),
  renderedPlayers: new Map(),
  shockwaves: [],
  input: { left: false, right: false, jumpToken: 0 },
  joined: false,
  lastInputSent: '',
  nextShockwaveAt: 0,
  isAdmin: false,
  shockHeld: false,
  fps: 0,
  framesThisSecond: 0,
  lastFpsAt: performance.now()
};

let toastTimer = 0;
let shockSpamTimer = 0;

window.setTimeout(() => {
  loadingScreen?.classList.add('loading-screen-hidden');
}, 1000);

usernameInput.addEventListener('input', () => {
  syncAdminFields();
});

secretToggleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const input = document.querySelector(`#${button.dataset.target}`);
    if (!input) {
      return;
    }

    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    button.textContent = visible ? 'Show' : 'Hide';
  });
});

nativeColorInput.addEventListener('input', () => {
  colorInput.value = nativeColorInput.value;
});

colorInput.addEventListener('input', () => {
  const color = colorInput.value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    nativeColorInput.value = color;
  }
});

joinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();

  const username = usernameInput.value.trim().replace(/\s+/g, ' ');
  const color = colorInput.value.trim();
  const isAdminName = isReservedAdminName(username);

  if (!isValidUsername(username)) {
    return showError('Use 2-16 Korean/English letters, numbers, spaces, underscores, or hyphens.');
  }

  if (isAdminName && (!adminPassphraseInput.value || !/^\d{6}$/.test(adminCodeInput.value))) {
    return showError('Reserved names need the admin password and 6-digit passcode.');
  }

  if (!isValidColorFormat(color)) {
    return showError('Use a valid hex, rgb(), or rgba() color.');
  }

  startButton.disabled = true;
  startButton.textContent = 'Checking...';

  try {
    const response = await fetch(`/api/username/${encodeURIComponent(username)}`);
    const result = await response.json();
    if (!response.ok || !result.available) {
      throw new Error(result.reason || 'That username is already active.');
    }

    connect(username, color, isAdminName ? adminPassphraseInput.value : '', isAdminName ? adminCodeInput.value : '');
  } catch (error) {
    showError(error.message || 'Could not check username. Try again.');
    startButton.disabled = false;
    startButton.textContent = 'Start';
  }
});

function connect(username, color, adminPassphrase, adminCode) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}`);
  state.socket = socket;

  socket.addEventListener('open', () => {
    connectionStatus.textContent = 'Connected';
    socket.send(JSON.stringify({ type: 'join', username, color, adminPassphrase, adminCode }));
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    handleServerMessage(message);
  });

  socket.addEventListener('close', () => {
    connectionStatus.textContent = 'Disconnected';
    showToast('Connection lost. Refresh to rejoin.');
  });

  socket.addEventListener('error', () => {
    showError('Connection failed. Make sure the server is running.');
    startButton.disabled = false;
    startButton.textContent = 'Start';
  });
}

function handleServerMessage(message) {
  if (message.type === 'joinRejected') {
    showError(message.reason);
    state.socket?.close();
    startButton.disabled = false;
    startButton.textContent = 'Start';
    return;
  }

  if (message.type === 'joined') {
    state.localId = message.id;
    state.arena = message.arena;
    state.platforms = message.platforms || [];
    state.isAdmin = Boolean(message.isAdmin);
    state.shockwave = message.shockwave || state.shockwave;
    state.joined = true;
    landing.classList.add('hidden');
    game.classList.remove('hidden');
    startButton.disabled = false;
    startButton.textContent = 'Start';
    resizeCanvasForDevice();
    requestAnimationFrame(render);
    return;
  }

  if (message.type === 'state') {
    state.players = new Map(message.players.map((player) => [player.id, normalizePlayer(player)]));
    seedRenderedPlayers();
    updateHud();
    return;
  }

  if (message.type === 'event') {
    if (message.event === 'stomp') {
      showToast(`${message.attacker} stomped ${message.target}`);
    } else if (message.event === 'shockwave') {
      state.shockwaves.push({ ...message, startedAt: performance.now() });
      if (message.playerId === state.localId) {
        state.nextShockwaveAt = performance.now() + state.shockwave.cooldownMs;
      }
      showToast(`${message.username} used shockwave${message.hitCount ? ` (${message.hitCount} hit)` : ''}`);
    } else if (message.event === 'shockwaveBlocked') {
      state.nextShockwaveAt = performance.now() + message.readyIn;
      showToast(`Shockwave ready in ${(message.readyIn / 1000).toFixed(1)}s`);
    } else if (message.event === 'system') {
      showToast(message.message);
    }
  }
}

window.addEventListener('keydown', (event) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'a', 'd', 'w', 'A', 'D', 'W'].includes(event.key)) {
    event.preventDefault();
  }

  if (event.key === ' ' && !event.repeat) {
    state.shockHeld = true;
    sendShockwave();
    startShockSpam();
    return;
  }

  setKey(event.key, true, event.repeat);
});

window.addEventListener('keyup', (event) => {
  if (event.key === ' ') {
    state.shockHeld = false;
    stopShockSpam();
    return;
  }

  setKey(event.key, false, false);
});
window.addEventListener('resize', resizeCanvasForDevice);

window.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'u') {
    event.preventDefault();
    showToast('Page source is disabled here. Server code is not sent to browsers.');
  }
});

function setKey(key, pressed, repeat) {
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') state.input.left = pressed;
  if (key === 'ArrowRight' || key === 'd' || key === 'D') state.input.right = pressed;
  if (pressed && !repeat && (key === 'ArrowUp' || key === 'w' || key === 'W')) state.input.jumpToken += 1;
  sendInput();
}

function sendInput() {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.joined) {
    return;
  }

  const payload = JSON.stringify(state.input);
  if (payload === state.lastInputSent) {
    return;
  }

  state.socket.send(JSON.stringify({ type: 'input', input: state.input }));
  state.lastInputSent = payload;
}

function sendShockwave() {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN || !state.joined) {
    return;
  }

  const now = performance.now();
  const serverReadyIn = state.players.get(state.localId)?.shockReadyIn || 0;
  const readyIn = Math.max(0, state.nextShockwaveAt - now, serverReadyIn);
  if (readyIn > 0) {
    showToast(`Shockwave ready in ${(readyIn / 1000).toFixed(1)}s`);
    return;
  }

  state.nextShockwaveAt = now + state.shockwave.cooldownMs;
  state.socket.send(JSON.stringify({ type: 'shockwave' }));
}

function startShockSpam() {
  if (!state.isAdmin || shockSpamTimer) {
    return;
  }

  shockSpamTimer = window.setInterval(() => {
    if (state.shockHeld) {
      sendShockwave();
    }
  }, state.shockwave.cooldownMs);
}

function stopShockSpam() {
  window.clearInterval(shockSpamTimer);
  shockSpamTimer = 0;
}

function syncAdminFields() {
  const enabled = isReservedAdminName(usernameInput.value);
  adminFields.classList.toggle('hidden', !enabled);
  adminPassphraseInput.disabled = !enabled;
  adminCodeInput.disabled = !enabled;

  if (!enabled) {
    adminPassphraseInput.value = '';
    adminCodeInput.value = '';
    adminPassphraseInput.type = 'password';
    adminCodeInput.type = 'password';
    secretToggleButtons.forEach((button) => {
      button.textContent = 'Show';
    });
  }
}

function render() {
  if (!state.joined) {
    return;
  }

  const { width, height, ratio } = getCanvasMetrics();
  updateFps();
  updateRenderedPlayers();
  const camera = getCamera(width, height);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height, camera);
  drawPlatforms(camera);
  drawShockwaves(camera);

  for (const player of state.renderedPlayers.values()) {
    drawPlayer(player, camera);
  }

  updateHud();
  requestAnimationFrame(render);
}

function drawBackground(width, height, camera) {
  ctx.save();
  ctx.fillStyle = '#10131a';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
  ctx.lineWidth = 1;

  const grid = 80;
  const startX = Math.floor(camera.x / grid) * grid;
  const endX = camera.x + camera.viewWidth;

  for (let x = startX; x <= endX; x += grid) {
    const screenX = (x - camera.x) * camera.scale;
    ctx.beginPath();
    ctx.moveTo(screenX, 0);
    ctx.lineTo(screenX, height);
    ctx.stroke();
  }

  for (let y = 0; y <= state.arena.height; y += grid) {
    const screenY = (y - camera.y) * camera.scale;
    ctx.beginPath();
    ctx.moveTo(0, screenY);
    ctx.lineTo(width, screenY);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(74, 222, 128, 0.16)';
  ctx.fillRect((0 - camera.x) * camera.scale, 0, 5, height);
  ctx.fillRect((state.arena.width - camera.x) * camera.scale - 5, 0, 5, height);
  ctx.restore();
}

function drawPlatforms(camera) {
  ctx.save();

  for (const platform of state.platforms) {
    if (platform.x + platform.width < camera.x || platform.x > camera.x + camera.viewWidth) {
      continue;
    }

    const x = (platform.x - camera.x) * camera.scale;
    const y = (platform.y - camera.y) * camera.scale;
    const width = platform.width * camera.scale;
    const height = platform.height * camera.scale;

    ctx.fillStyle = platform.y > 650 ? '#334155' : '#475569';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(x, y, width, Math.max(3, 5 * camera.scale));
  }

  ctx.restore();
}

function drawPlayer(player, camera) {
  const x = (player.x - camera.x) * camera.scale;
  const y = (player.y - camera.y) * camera.scale;
  const size = PLAYER_SIZE * camera.scale;
  const isLocal = player.id === state.localId;

  ctx.save();
  ctx.globalAlpha = player.invulnerable ? 0.6 : 1;
  ctx.fillStyle = player.color;
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = isLocal ? '#ffffff' : 'rgba(255, 255, 255, 0.55)';
  ctx.lineWidth = isLocal ? 4 : 2;
  ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
  ctx.globalAlpha = 1;

  ctx.font = '700 15px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.strokeText(player.username, x + size / 2, y - 6);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(player.username, x + size / 2, y - 6);
  ctx.restore();
}

function drawShockwaves(camera) {
  const now = performance.now();
  state.shockwaves = state.shockwaves.filter((shockwave) => now - shockwave.startedAt < 520);

  ctx.save();
  for (const shockwave of state.shockwaves) {
    const age = (now - shockwave.startedAt) / 520;
    const radius = shockwave.radius * age * camera.scale;
    const x = (shockwave.x - camera.x) * camera.scale;
    const y = (shockwave.y - camera.y) * camera.scale;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(74, 222, 128, ${Math.max(0, 1 - age)})`;
    ctx.lineWidth = Math.max(2, 10 * (1 - age));
    ctx.stroke();
  }
  ctx.restore();
}

function getCamera(width, height) {
  const scale = height / state.arena.height;
  const viewWidth = width / scale;
  const viewHeight = height / scale;
  const local = state.renderedPlayers.get(state.localId) || state.players.get(state.localId);
  const focusX = local ? local.x + PLAYER_SIZE / 2 : viewWidth / 2;
  const focusY = local ? local.y + PLAYER_SIZE / 2 : viewHeight / 2;

  return {
    x: clamp(focusX - viewWidth / 2, 0, Math.max(0, state.arena.width - viewWidth)),
    y: clamp(focusY - viewHeight * 0.58, 0, Math.max(0, state.arena.height - viewHeight)),
    scale,
    viewWidth,
    viewHeight
  };
}

function updateHud() {
  const players = [...state.players.values()].sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
  const local = state.players.get(state.localId);
  const remaining = Math.max(0, state.nextShockwaveAt - performance.now(), local?.shockReadyIn || 0);

  playerCount.textContent = `${players.length} player${players.length === 1 ? '' : 's'}`;
  coordinates.textContent = local ? `x: ${formatWorldUnit(local.x)} y: ${formatWorldUnit(local.y)} z: 0.00` : 'x: 0.00 y: 0.00 z: 0.00';
  fpsStatus.textContent = `FPS: ${state.fps}`;
  shockStatus.textContent = remaining > 0 ? `Shockwave: ${(remaining / 1000).toFixed(1)}s` : 'Shockwave: Ready';
  scoreboard.replaceChildren(...players.map((player) => {
    const item = document.createElement('li');
    item.textContent = `${player.username}: ${player.score}`;
    item.style.borderColor = player.color;
    return item;
  }));
}

function normalizePlayer(player) {
  return {
    ...player,
    z: 0,
    vx: player.vx || 0,
    vy: player.vy || 0
  };
}

function seedRenderedPlayers() {
  for (const [id, player] of state.players) {
    if (!state.renderedPlayers.has(id)) {
      state.renderedPlayers.set(id, { ...player });
    }
  }

  for (const id of state.renderedPlayers.keys()) {
    if (!state.players.has(id)) {
      state.renderedPlayers.delete(id);
    }
  }
}

function updateRenderedPlayers() {
  for (const [id, target] of state.players) {
    const rendered = state.renderedPlayers.get(id);
    if (!rendered) {
      state.renderedPlayers.set(id, { ...target });
      continue;
    }

    const amount = id === state.localId ? 0.45 : 0.28;
    rendered.x += (target.x - rendered.x) * amount;
    rendered.y += (target.y - rendered.y) * amount;
    rendered.vx = target.vx;
    rendered.vy = target.vy;
    rendered.score = target.score;
    rendered.invulnerable = target.invulnerable;
    rendered.shockReadyIn = target.shockReadyIn;
  }
}

function resizeCanvasForDevice() {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
}

function getCanvasMetrics() {
  const ratio = window.devicePixelRatio || 1;
  return {
    width: canvas.width / ratio,
    height: canvas.height / ratio,
    ratio
  };
}

function isValidColorFormat(value) {
  const color = value.trim();
  const hex = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
  const rgb = /^rgba?\(\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)\s*,\s*(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\s*,\s*(?:0(?:\.\d+)?|1(?:\.0+)?|\.\d+))?\s*\)$/i;
  return hex.test(color) || rgb.test(color);
}

function isValidUsername(value) {
  const username = value.trim().replace(/\s+/g, ' ');
  const length = [...username].length;
  return length >= 2 && length <= 16 && /^[\p{L}\p{N} _-]+$/u.test(username);
}

function isReservedAdminName(value) {
  const username = value.trim().replace(/\s+/g, ' ').toLowerCase();
  return username === '강지오' || username === 'trixie';
}

function updateFps() {
  const now = performance.now();
  state.framesThisSecond += 1;

  if (now - state.lastFpsAt >= 1000) {
    state.fps = Math.round((state.framesThisSecond * 1000) / (now - state.lastFpsAt));
    state.framesThisSecond = 0;
    state.lastFpsAt = now;
  }
}

function formatWorldUnit(value) {
  return (value / 100).toFixed(2);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function showError(message) {
  joinError.textContent = message;
}

function clearError() {
  joinError.textContent = '';
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('visible'), 2200);
}
