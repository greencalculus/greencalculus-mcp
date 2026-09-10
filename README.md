# GreenCalculus MCP server

Sourced greenhouse-gas emission factors and audit-traced carbon calculations, as an MCP server. Every value comes back with its exact source cell and a pinned data version — so an agent hands back a number a person can cite and a machine can reproduce, instead of a guess.

## Do you need this package?

Probably not. **The server is remote**, and if your client speaks remote MCP you should point it straight at the URL — nothing to install, nothing to update:

```json
{
  "mcpServers": {
    "greencalculus": {
      "url": "https://mcp.greencalculus.com",
      "headers": { "Authorization": "Bearer YOUR_KEY" }
    }
  }
}
```

This package exists for the clients that can only spawn a local stdio process, and for `docker run` installs. It is a thin bridge: it forwards each JSON-RPC message to the remote server and returns the reply verbatim. No method is special-cased, so new tools appear here without a release.

## Use it over stdio

```json
{
  "mcpServers": {
    "greencalculus": {
      "command": "npx",
      "args": ["-y", "greencalculus-mcp"],
      "env": { "GREENCALCULUS_API_KEY": "YOUR_KEY" }
    }
  }
}
```

Or with Docker — `-i` is required and `-t` must be omitted, because the container's stdin/stdout *are* the transport and a TTY corrupts the stream:

```json
{
  "mcpServers": {
    "greencalculus": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "GREENCALCULUS_API_KEY", "greencalculus/mcp"],
      "env": { "GREENCALCULUS_API_KEY": "YOUR_KEY" }
    }
  }
}
```

Get a free key at **https://greencalculus.com/developers** — no card. Discovery (`initialize`, `tools/list`) works without one, and so do `search_factors` and `explain_absence`; every other tool needs a key.

## Tools

| Tool | What it does |
|---|---|
| `lookup_factor` | Fetch one emission factor by key, with its source and version |
| `lookup_factors` | Fetch many factors by key in one call — a portfolio is one request, not one per factor |
| `search_factors` | Search the corpus by free text |
| `resolve_factor` | Map a messy real-world description to the best-matching factor |
| `explain_absence` | Say *why* a factor does not exist, rather than returning nothing |
| `calculate_activity` | Activity → emissions, with unit conversion and GHG Protocol scope |
| `calculate_electricity` | Location-based and market-based electricity |
| `calculate_embodied` | Embodied carbon (EN 15978), explicit about missing lifecycle stages |
| `calculate_pcaf` | PCAF financed emissions, with the audit trail |
| `calculate_freight` | Freight by mode, distance and load |
| `calculate_spend` | Spend-based EEIO |
| `calculate_business_travel` | Business travel across modes |

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `GREENCALCULUS_API_KEY` | — | Your API key. `GC_API_KEY` is accepted as an alias; the explicit name wins. |
| `GREENCALCULUS_MCP_URL` | `https://mcp.greencalculus.com` | Override the endpoint. |
| `GREENCALCULUS_MCP_TIMEOUT_MS` | `120000` | Per-request timeout. |

Diagnostics go to stderr. Nothing but JSON-RPC is ever written to stdout — a stray byte there corrupts the session.

## Develop

```bash
npm test                      # unit tests, no network
node bin/greencalculus-mcp.js # reads JSON-RPC on stdin
docker build -t greencalculus/mcp .
```

## Releasing

Bump `version` in `package.json`, merge to `main`. That's the whole procedure.

[`release.yml`](.github/workflows/release.yml) asks npm and the MCP registry
whether they already have that version and publishes only where they don't, so
a merge that bumps ships it and a merge that doesn't is a no-op. It also runs
weekly, so a publish that failed is retried without a new commit.

`server.json` is the registry manifest, and the workflow rewrites its version
from `package.json` before publishing — one source of truth, three places that
have to agree. npm authenticates by
[trusted publishing](https://docs.npmjs.com/trusted-publishers) and the registry
by GitHub OIDC, so there is no publishing token in this repo.

## Also available

- **REST API** and docs — https://greencalculus.com/developers
- **Client SDKs** (Python, JS/TS) — https://github.com/greencalculus/greencalculus-sdk
- **Official MCP registry** — `com.greencalculus/api`
- **Smithery** — https://smithery.ai/servers/greencalculus/api

## Licence

MIT — see [LICENSE](./LICENSE). The licence covers this bridge. Emission-factor data returned by the API carries the licence of its underlying source, which is named in every response.
