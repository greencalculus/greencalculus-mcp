/**
 * stdio → Streamable-HTTP bridge for the GreenCalculus MCP server.
 *
 * The real server is remote (https://mcp.greencalculus.com). Clients that speak
 * remote MCP should point at it directly — this bridge exists for the ones that
 * only know how to spawn a local stdio process, and for `docker run` installs.
 *
 * It is deliberately a dumb pipe: every JSON-RPC message is forwarded verbatim
 * and every reply is returned verbatim. No method is special-cased, so new tools
 * and protocol revisions on the server need no release here.
 */

const DEFAULT_URL = 'https://mcp.greencalculus.com';

// Long enough for the slowest calc engine, short enough that a hung request
// surfaces as an error rather than a client that appears to have frozen.
const DEFAULT_TIMEOUT_MS = 120_000;

export function config(env = process.env) {
  const timeout = Number.parseInt(env.GREENCALCULUS_MCP_TIMEOUT_MS ?? '', 10);
  return {
    url: env.GREENCALCULUS_MCP_URL || DEFAULT_URL,
    // GC_API_KEY is accepted as an alias because that is the name the REST SDKs
    // use; the explicit GREENCALCULUS_API_KEY wins when both are set.
    apiKey: env.GREENCALCULUS_API_KEY || env.GC_API_KEY || '',
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

/**
 * One JSON-RPC message out, one parsed reply back.
 *
 * Returns null when the server answers with no body — a notification is
 * answered with 202 and nothing else, and writing anything to stdout for it
 * would violate the JSON-RPC contract.
 */
export async function forward(message, cfg, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetchImpl(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(message),
      signal: controller.signal,
    });

    const text = await res.text();
    if (!text.trim()) return null;

    try {
      return JSON.parse(text);
    } catch {
      // A non-JSON body means something between us and the server answered —
      // a proxy error page, a captive portal. Surfacing the status is what
      // makes that diagnosable rather than a bare parse failure.
      throw new Error(`non-JSON reply from ${cfg.url} (HTTP ${res.status})`);
    }
  } finally {
    clearTimeout(timer);
  }
}

const isNotification = (msg) => msg == null || msg.id === undefined || msg.id === null;

export function run(io = {}) {
  const stdin = io.stdin ?? process.stdin;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const cfg = io.config ?? config();
  const fetchImpl = io.fetch ?? fetch;

  const write = (obj) => stdout.write(`${JSON.stringify(obj)}\n`);

  // Messages are handled without awaiting each other: a slow tools/call must
  // not hold up an interleaved tools/list. JSON-RPC identifies replies by id,
  // so out-of-order returns are correct.
  const handle = async (line) => {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }

    try {
      const reply = await forward(msg, cfg, fetchImpl);
      if (reply !== null && !isNotification(msg)) write(reply);
    } catch (err) {
      const message = err?.name === 'AbortError'
        ? `GreenCalculus MCP request timed out after ${cfg.timeoutMs}ms`
        : `GreenCalculus MCP transport error: ${err?.message ?? String(err)}`;
      stderr.write(`${message}\n`);
      if (!isNotification(msg)) {
        write({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message } });
      }
    }
  };

  let buffer = '';
  stdin.setEncoding('utf8');
  stdin.on('data', (chunk) => {
    buffer += chunk;
    // The stdio transport is newline-delimited; a chunk can hold several
    // messages or a fraction of one, so the trailing partial stays buffered.
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) void handle(line);
    }
  });

  return new Promise((resolve) => {
    stdin.on('end', () => {
      const rest = buffer.trim();
      if (rest) void handle(rest);
      resolve();
    });
  });
}
