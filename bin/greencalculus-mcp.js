#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, run } from '../src/bridge.js';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

const argv = process.argv.slice(2);

if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write(`greencalculus-mcp ${pkg.version}

  Runs the GreenCalculus MCP server over stdio by bridging to the remote
  server at https://mcp.greencalculus.com. If your client supports remote
  MCP, point it at that URL directly instead — you do not need this.

  Environment:
    GREENCALCULUS_API_KEY        API key. Free at greencalculus.com/developers.
                                 GC_API_KEY is accepted as an alias.
    GREENCALCULUS_MCP_URL        Override the endpoint (default ${'https://mcp.greencalculus.com'}).
    GREENCALCULUS_MCP_TIMEOUT_MS Per-request timeout (default 120000).

  Discovery (initialize, tools/list) works without a key; calling a tool
  needs one.
`);
  process.exit(0);
}

const cfg = config();
if (!cfg.apiKey) {
  // stderr, never stdout: stdout carries the JSON-RPC stream and any stray
  // byte on it corrupts the session. Not fatal — discovery is keyless, and a
  // client that only introspects should still start cleanly.
  process.stderr.write(
    'greencalculus-mcp: no GREENCALCULUS_API_KEY set — discovery will work, tool calls will be refused. Free key: https://greencalculus.com/developers\n',
  );
}

await run();
