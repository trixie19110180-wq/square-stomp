# Square Stomp

A real-time multiplayer browser game. Players join with a unique username and a custom hex, rgb, or rgba color, then move a colored square through a side-scrolling platform map. Landing on another player awards the stomping player one point and respawns the stomped player.

## Run locally

```bash
pnpm install
pnpm start
```

Open `http://localhost:3000` in two or more browser windows to test multiplayer.

If your computer does not have `pnpm` or `node` in Terminal, use the Codex-bundled tools:

```bash
cd /Users/jinheean/Documents/multiplayer-square-stomp && PATH="/Users/jinheean/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" /Users/jinheean/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm install && PATH="/Users/jinheean/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH" /Users/jinheean/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/pnpm start
```

## Controls

- Move left/right: `A` and `D`, or arrow keys
- Jump: `W`, up arrow, or space

## Project structure

- `server.js` manages active players, unique usernames, platform physics, stomp detection, scoring, respawns, and WebSocket broadcasts.
- `public/index.html` contains the landing screen and game canvas.
- `public/styles.css` handles responsive layout and visual design.
- `public/game.js` handles joining, keyboard input, WebSocket messages, camera scrolling, drawing, errors, and the scoreboard.

## Make it a real web game for free

You need a host that supports long-running Node servers and WebSockets. Static-only hosts such as basic GitHub Pages cannot run this game server by themselves.

See `DEPLOY.md` for beginner step-by-step GitHub and Render instructions.

Free options:

1. Put this project in a GitHub repository.
2. Create a free account on a platform with Node/WebSocket support, such as Render, Railway, Fly.io, or Koyeb. Free plans change over time, so check each platform before relying on it.
3. Create a new Web Service from your GitHub repository.
4. Use these settings:
   - Build command: `corepack enable && pnpm install --frozen-lockfile`
   - Start command: `pnpm start`
   - Port: use the platform-provided `PORT` environment variable. This app already supports it.
5. Deploy, then share the generated `https://...` URL with players.

For a no-card, no-server alternative, you can run it from your own computer and share it temporarily with a free tunnel such as Cloudflare Tunnel. The game only stays online while your computer and server are running.
