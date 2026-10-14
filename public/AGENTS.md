# Agents.md — connecting an agent to Drains

Drains is a running engineering log. A **drain** is one log
channel — one per project, incident, or team. This file is for AI
agents (Claude Code, or anything MCP-compatible) that read or write
to a drain.

## Why an agent would connect

- **Read for context.** Query the drain before starting work — why a
  decision was made, what broke last time, what shipped this week.
- **Write as you work.** Log what you did and why, the same way a
  person would. Agent-written entries are attributed ("via
  <token name>") and appear in the same timeline as everything else —
  not a separate audit log.

## Install as a Claude skill (easiest)

The Drains skill is a thin layer on top of the same MCP server below — it
depends on the MCP connection, it doesn't replace it. Installing it sets that
connection up for you:

```sh
npx skills add https://github.com/drains-dev/claude-plugin --skill drains
```

Claude then reads a project's drain for context before starting work, and
appends entries as it goes. You still need a token (see below) — set it as
`DRAINS_API_TOKEN` (and `DRAINS_API_URL` if you're not using the default
host) in your environment.

## Connect via MCP (manual)

Skip the skill and configure this MCP server directly — needed if you're on
a different MCP client, or want to wire it up yourself. Add this to your MCP
client's config (Claude Desktop's `claude_desktop_config.json`, or Claude
Code's `.claude/settings.json` under `mcpServers`):

```json
{
  "mcpServers": {
    "drains": {
      "command": "npx",
      "args": ["-y", "github:drains-dev/mcp"],
      "env": { "DRAINS_API_URL": "https://drains.dev", "DRAINS_API_TOKEN": "<your-token>" }
    }
  }
}
```

No install step — `npx` fetches it on first run.

## Get a token

Open a drain in the app, click your avatar in the sidebar → **API
tokens** → create one. Tokens are scoped to your account, not a
single drain, and can be revoked at any time from the same menu.

## What an agent can do

- Read entries in any drain the token's account can access
- Create new entries (@mentions and `[[ references ]]` are parsed the
  same way they are for a human-typed entry)
- File entries into **streams**, topics inside a drain (e.g. `HCI`,
  `Releases`): pass `streams` to `append_entry`, and call `list_streams`
  first to reuse existing names. Listed entries carry their `streams`.
- List and manage drain members
- Update drain metadata (title, description, tags)

Entries created via a token carry a `via <token name>` attribution —
they're always distinguishable from who actually wrote them.
