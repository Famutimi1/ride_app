# Claude Code Skills & Plugins

Which Claude Code skills/plugins help build *this* project, how to install them,
and how to encode our own rules as project skills. This is about the **AI dev
tooling**, not the app's runtime dependencies — for those see
`docs/setup/dependencies.md`.

> **Provenance:** Researched on **2026-08-22** against the official docs
> (`code.claude.com/docs`) and the Anthropic marketplace catalogs. The ecosystem
> moves fast — re-check the marketplace with `/plugin` before relying on a name.

---

## How skills & plugins work (quick)

- A **skill** is a folder with a `SKILL.md` file (YAML frontmatter + Markdown).
  Only the `description` is loaded into context all the time; the full body loads
  when Claude auto-invokes it (based on the description) or you type `/skill-name`.
- A **plugin** bundles skills (and optionally agents, hooks, MCP servers) and
  installs from a marketplace.
- **Skill locations** (project ones are committed to the repo so the whole team
  gets them):
  | Scope | Path |
  |---|---|
  | Personal | `~/.claude/skills/<name>/SKILL.md` |
  | Project | `.claude/skills/<name>/SKILL.md` |
  | Plugin | `<plugin>/skills/<name>/SKILL.md` → `/plugin-name:skill-name` |
- **Monorepo-aware:** a nested `.claude/skills/` under `mobile/` or `backend/`
  activates when Claude touches files there — handy for our split repo.

Install commands: `/plugin` (interactive), `/plugin install <name>@<marketplace>`,
`/plugin marketplace add <owner/repo>`.

---

## Install these (priority order)

| # | Plugin | Install | Why for this project |
|---|---|---|---|
| 1 ⭐ | **expo** (official Expo team) | `/plugin install expo@claude-plugins-official` | ~25 skills: `expo-router`, `expo-animation` (Reanimated), `expo-dev-client`, `expo-native-ui`, plus **EAS** build/deploy skills. Built for SDK 57. This is the "Expo skill" this project needs most. |
| 2 | **typescript-lsp** | `/plugin install typescript-lsp@claude-plugins-official` | Real code intelligence (go-to-def, diagnostics, refactors) across **both** `mobile/` and `backend/` — the whole stack is TS. Closest thing to a "TypeScript skill." |
| 3 | **context7** | via `/plugin` marketplace | Pulls *current* library docs into context. Valuable because SDK 57 / Paystack / Socket.io move faster than model training data. |
| 4 | **skill-creator** + **hookify** | `@claude-plugins-official` | To author our own project skills and (via hooks) enforce non-negotiables deterministically. See below. |

---

## Already bundled — don't install duplicates

These ship with Claude Code (zero install): `/code-review`, `/security-review`,
`/simplify`, `/run`, `/init`, `/loop`. Marketplace plugins like `code-review`,
`claude-security`, or `coderabbit` overlap these — only add them if you
specifically want the heavier workflow. Start with what's bundled.

---

## Highest-leverage move: author our own project skills

`AGENTS.md` / `CLAUDE.md` already encode strict rules. Turning the top ones into
`.claude/skills/` files (committed to the repo) means an AI agent auto-applies
them every session, and the rules survive context resets. Strong candidates:

- **`wallet-ledger`** — enforce append-only, offsetting-rows-only corrections,
  and `SELECT ... FOR UPDATE` inside a transaction for balance changes.
- **`trip-state-machine`** — validate every trip status change against the
  allowed transitions (`requested → accepted → driver_arriving → in_progress →
  completed/cancelled`).
- **`sql-safety`** — parameterized queries only. This one is a good candidate to
  also enforce as a **hookify** hook that blocks string-concatenated SQL.

Use **skill-creator** to scaffold and evaluate these.

---

## Gaps — no plugin exists for these (as of 2026-08-22)

- **Paystack** — no payment plugin for it (the ecosystem has Stripe/Airwallex/
  MercadoPago-class ones). Rely on `context7` for docs + a project skill.
- **Redis** — no verified Redis/Upstash plugin found. Use `typescript-lsp` +
  project skills for the matching/live-location code.
- **React Native native E2E** (Detox/Maestro) — no dedicated plugin. The
  `webapp-testing` skill is Playwright/**web** only. For native flows, wire up
  Detox/Maestro yourself, or use the Expo plugin's `eas-simulator` skill.

---

## Links
- Skills docs — https://code.claude.com/docs/en/skills
- Plugins docs — https://code.claude.com/docs/en/plugins
- Official marketplace — https://github.com/anthropics/claude-plugins-official
- Community marketplace — https://github.com/anthropics/claude-plugins-community
- Anthropic skills repo — https://github.com/anthropics/skills
- Expo skills — https://github.com/expo/skills
- Discovery index — https://github.com/hesreallyhim/awesome-claude-code
- Related: `docs/setup/dependencies.md`
