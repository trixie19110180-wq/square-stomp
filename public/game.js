const landing = document.querySelector('#landing');
const game = document.querySelector('#game');
const joinForm = document.querySelector('#joinForm');
const usernameInput = document.querySelector('#username');
const nativeColorInput = document.querySelector('#nativeColor');
const colorInput = document.querySelector('#color');
const startButton = document.querySelector('#startButton');
const joinError = document.querySelector('#joinError');
const canvas = document.querySelector('#arena');
const ctx = canvas.getContext('2d');
const connectionStatus = document.querySelector('#connectionStatus');
const playerCount = document.querySelector('#playerCount');
const scoreboard = document.querySelector('#scoreboard');
const toast = document.querySelector('#toast');

const PLAYER_SIZE = 42;
const state = {
  socket: null,
  localId: '',
  arena: { width: 3600, height: 720 },
  platforms: [],
  players: new Map(),
  input: { left: false, right: false, jump: false },
  joined: false,
  lastInputSent: ''
};

let toastTimer = 0;

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

  if (!/^[a-zA-Z0-9 _-]{2,16}$/.test(username)) {
    return showError('Use 2-16 letters, numbers, spaces, underscores, or hyphens.');
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

    connect(username, color);
  } catch (error) {
    showError(error.message || 'Could not check username. Try again.');
    startButton.disabled = false;
    startButton.textContent = 'Start';
  }
});

function connect(username, color) {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${location.host}`);
  state.socket = socket;

  socket.addEventListener('open', () => {
    connectionStatus.textContent = 'Connected';
    socket.send(JSON.stringify({ type: 'join', username, color }));
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
    state.players = new Map(message.players.map((player) => [player.id, player]));
    updateHud();
    return;
  }

  if (message.type === 'event') {
    if (message.event === 'stomp') {
      showToast(`${message.attacker} stomped ${message.target}`);
    } else if (message.event === 'system') {
      showToast(message.message);
    }
  }
}

window.addEventListener('keydown', (event) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', ' ', 'a', 'd', 'w', 'A', 'D', 'W'].includes(event.key)) {
    event.preventDefault();
  }

  setKey(event.key, true);
});

window.addEventListener('keyup', (event) => setKey(event.key, false));
window.addEventListener('resize', resizeCanvasForDevice);

function setKey(key, pressed) {
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') state.input.left = pressed;
  if (key === 'ArrowRight' || key === 'd' || key === 'D') state.input.right = pressed;
  if (key === 'ArrowUp' || key === 'w' || key === 'W' || key === ' ') state.input.jump = pressed;
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

function render() {
  if (!state.joined) {
    return;
  }

  const { width, height, ratio } = getCanvasMetrics();
  const camera = getCamera(width, height);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawBackground(width, height, camera);
  drawPlatforms(camera);

  for (const player of state.players.values()) {
    drawPlayer(player, camera);
  }

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

function getCamera(width, height) {
  const scale = height / state.arena.height;
  const viewWidth = width / scale;
  const viewHeight = height / scale;
  const local = state.players.get(state.localId);
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
  playerCount.textContent = `${players.length} player${players.length === 1 ? '' : 's'}`;
  scoreboard.replaceChildren(...players.map((player) => {
    const item = document.createElement('li');
    item.textContent = `${player.username}: ${player.score}`;
    item.style.borderColor = player.color;
    return item;
  }));
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
