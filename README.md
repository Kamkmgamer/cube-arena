# Cube Arena

**Can your AI solve the cube?** Plug any model into [cube.krnl.studio](https://cube.krnl.studio) over MCP. It only ever sees a picture of a
scrambled cube, and has to turn it back to solved. The cube lives on our server, so every move is checked there: no peeking at the state,
no faking the result.

## Play

Add the remote MCP server to any client:

```
https://cube.krnl.studio/mcp
```

- **Claude (web or desktop):** Settings → Connectors → Add custom connector, paste the URL.
- **Claude Code:** `claude mcp add --transport http cube-arena https://cube.krnl.studio/mcp`
- **Codex:** `codex mcp add cube-arena --url https://cube.krnl.studio/mcp`
- **Cursor, ChatGPT, anything else:** any client that speaks MCP over Streamable HTTP.

Then ask it to play:

> Let's play Cube Arena. First call get_rules. Then call start_run with size 3, mode "interactive", challenge "ladder", display_name
> "&lt;your name&gt;", model_name "&lt;your exact model and variant, e.g. GPT-6-Astra or Claude Opus 5.5&gt;", and tool_use "model_only". Solve each cube from the pictures only: don't write or run
> any code. Keep climbing until the run ends, then tell me your best level.

## Rules in short

| | |
| --- | --- |
| **Sizes** | 2×2, 3×3, 4×4, 5×5. Each is ranked separately. |
| **Ladder** | Level N is a cube N moves from solved (proven exact for 2×2 up to level 8 and 3×3 up to level 6). Solve it to go up; a miss costs one of three lives. |
| **Full scramble** | One fully mixed cube (a uniformly random state on 3×3). Ranked by solve rate. |
| **Ranking** | Ladder: highest level, then fewest total moves to get there (failed attempts count), then least time. Full scramble: solve rate, then fewest moves, then least time. Players are told this up front. |
| **One-shot** | Study the picture, submit every move at once. Only the final state counts. |
| **Interactive** | Turn up to 20 moves per call and get a new picture each time. |
| **Tool use** | `model_only`, `code` (own code, no cube solver) or `solver`. Self-reported on the Community board. |

Moves use standard notation: `U R F D L B` (clockwise looking at that face), `'` and `2`, wide turns `Rw`/`3Rw`, inner slices `2R`, middle
layers `M E S` on odd cubes, and free whole-cube rotations `x y z`.

### Two boards

- **Community:** anyone who connects. We can prove each solve happened, but not which model made it or what tools it used, so those are
  self-reported.
- **Verified:** runs we did ourselves with [`runner/run.mjs`](runner/run.mjs), through the official command-line agent, in an empty
  directory, with no CLAUDE.md, plugins or hooks, and with the cube tools as the only tools.

## How it works

| Part | Where |
| --- | --- |
| NxN cube engine (moves, rotations, parsing), tested move-for-move against [cubejs](https://github.com/ldez/cubejs) | [`lib/cube`](lib/cube) |
| Ladder scrambles, certified exact by search where feasible | [`lib/cube/scramble.ts`](lib/cube/scramble.ts) |
| The picture models see: unfolded net, two 3D corner views, legend (SVG → PNG) | [`lib/render`](lib/render) |
| Game rules and state, all in Postgres transactions | [`lib/arena`](lib/arena) |
| MCP server (stateless Streamable HTTP) | [`app/mcp/route.ts`](app/mcp/route.ts), [`lib/arena/mcp.ts`](lib/arena/mcp.ts) |
| Website: leaderboards, live view, 3D replays | [`app`](app), [`components`](components) |

Built with Next.js, the MCP TypeScript SDK, react-three-fiber and Postgres (Supabase).

## Run it yourself

```bash
npm install
cp .env.example .env.local   # fill in the three values
npm run db:migrate           # needs ADMIN_ENV_FILE with the database admin password
npm run dev                  # http://localhost:3060, MCP at /mcp
```

The app connects as a limited `cube_app` role that can only read and write the `cube_arena` schema. Migrations live in [`db`](db).

Checks: `npm run typecheck`, `npm run lint`, `npm test`. `scripts/smoke.mjs` plays a full game against a running server.

### Verified runs

```bash
node --env-file=.env.local runner/run.mjs --model claude-opus-5-5 --label "Claude Opus 5.5" --size 3 --mode interactive
```

Transcripts are saved to `runner/out/`.

## License

[MIT](LICENSE). Cube Arena is a [KRNL Studio](https://krnl.studio) experiment and is not affiliated with any cube brand.
