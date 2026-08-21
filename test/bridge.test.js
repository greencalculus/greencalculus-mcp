import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { config, forward, run } from '../src/bridge.js';

const CFG = { url: 'https://example.test/mcp', apiKey: '', timeoutMs: 5000 };

/** Collects what the bridge writes, as parsed lines. */
function sink() {
  const stream = new PassThrough();
  const chunks = [];
  stream.on('data', (c) => chunks.push(c.toString()));
  return {
    stream,
    lines: () => chunks.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)),
    raw: () => chunks.join(''),
  };
}

/** Drives run() with a scripted fetch and returns everything written to stdout. */
async function drive(input, fetchImpl, cfg = CFG) {
  const stdin = new PassThrough();
  const stdout = sink();
  const stderr = sink();
  const done = run({ stdin, stdout: stdout.stream, stderr: stderr.stream, config: cfg, fetch: fetchImpl });
  for (const chunk of [].concat(input)) stdin.write(chunk);
  stdin.end();
  await done;
  // handle() is not awaited by the read loop, so let the microtask queue drain.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  return { out: stdout.lines(), err: stderr.raw() };
}

const ok = (body) => async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

test('config prefers GREENCALCULUS_API_KEY over the GC_API_KEY alias', () => {
  assert.equal(config({ GREENCALCULUS_API_KEY: 'a', GC_API_KEY: 'b' }).apiKey, 'a');
  assert.equal(config({ GC_API_KEY: 'b' }).apiKey, 'b');
  assert.equal(config({}).apiKey, '');
});

test('config falls back to the default url and timeout on junk input', () => {
  assert.equal(config({}).url, 'https://mcp.greencalculus.com');
  assert.equal(config({ GREENCALCULUS_MCP_TIMEOUT_MS: 'soon' }).timeoutMs, 120_000);
  assert.equal(config({ GREENCALCULUS_MCP_TIMEOUT_MS: '-5' }).timeoutMs, 120_000);
  assert.equal(config({ GREENCALCULUS_MCP_TIMEOUT_MS: '900' }).timeoutMs, 900);
});

test('forward sends the bearer header only when a key is configured', async () => {
  let seen;
  const spy = async (_url, init) => (seen = init, { ok: true, status: 200, text: async () => '{"jsonrpc":"2.0","id":1,"result":{}}' });

  await forward({ id: 1 }, { ...CFG, apiKey: 'gc_live_x' }, spy);
  assert.equal(seen.headers.Authorization, 'Bearer gc_live_x');

  await forward({ id: 1 }, CFG, spy);
  assert.equal(seen.headers.Authorization, undefined);
});

test('forward returns null for an empty body', async () => {
  const res = await forward({ method: 'notifications/initialized' }, CFG, async () => ({ ok: true, status: 202, text: async () => '' }));
  assert.equal(res, null);
});

test('forward reports the status when the body is not JSON', async () => {
  await assert.rejects(
    () => forward({ id: 1 }, CFG, async () => ({ ok: false, status: 502, text: async () => '<html>bad gateway</html>' })),
    /HTTP 502/,
  );
});

test('a request gets its reply written as one line', async () => {
  const { out } = await drive(
    '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n',
    ok({ jsonrpc: '2.0', id: 1, result: { tools: [] } }),
  );
  assert.deepEqual(out, [{ jsonrpc: '2.0', id: 1, result: { tools: [] } }]);
});

test('a reply containing newlines is re-serialised to a single line', async () => {
  const stdin = new PassThrough();
  const stdout = sink();
  const done = run({
    stdin,
    stdout: stdout.stream,
    stderr: sink().stream,
    config: CFG,
    fetch: async () => ({ ok: true, status: 200, text: async () => '{\n  "jsonrpc": "2.0",\n  "id": 1,\n  "result": {}\n}' }),
  });
  stdin.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  stdin.end();
  await done;
  await new Promise((r) => setImmediate(r));
  // Exactly one newline — the delimiter — or the client's framing breaks.
  assert.equal(stdout.raw().trimEnd().includes('\n'), false);
});

test('notifications produce no stdout at all', async () => {
  const { out } = await drive(
    '{"jsonrpc":"2.0","method":"notifications/initialized"}\n',
    ok({ jsonrpc: '2.0', id: null, result: {} }),
  );
  assert.deepEqual(out, []);
});

test('several messages in one chunk are each forwarded', async () => {
  let calls = 0;
  const { out } = await drive(
    '{"jsonrpc":"2.0","id":1,"method":"ping"}\n{"jsonrpc":"2.0","id":2,"method":"ping"}\n',
    async () => (calls++, { ok: true, status: 200, text: async () => `{"jsonrpc":"2.0","id":${calls},"result":{}}` }),
  );
  assert.equal(calls, 2);
  assert.equal(out.length, 2);
});

test('a message split across chunks is buffered until its newline', async () => {
  const { out } = await drive(
    ['{"jsonrpc":"2.0","id":1,', '"method":"ping"}\n'],
    ok({ jsonrpc: '2.0', id: 1, result: {} }),
  );
  assert.deepEqual(out, [{ jsonrpc: '2.0', id: 1, result: {} }]);
});

test('a final message with no trailing newline is still handled', async () => {
  const { out } = await drive(
    '{"jsonrpc":"2.0","id":7,"method":"ping"}',
    ok({ jsonrpc: '2.0', id: 7, result: {} }),
  );
  assert.equal(out.length, 1);
});

test('unparseable input yields a JSON-RPC parse error, not a crash', async () => {
  const { out } = await drive('not json\n', ok({}));
  assert.equal(out[0].error.code, -32700);
  assert.equal(out[0].id, null);
});

test('a transport failure becomes an error reply and a stderr note', async () => {
  const { out, err } = await drive(
    '{"jsonrpc":"2.0","id":3,"method":"ping"}\n',
    async () => { throw new Error('ECONNREFUSED'); },
  );
  assert.equal(out[0].error.code, -32603);
  assert.equal(out[0].id, 3);
  assert.match(err, /ECONNREFUSED/);
});

test('a failed notification writes nothing to stdout', async () => {
  const { out, err } = await drive(
    '{"jsonrpc":"2.0","method":"notifications/cancelled"}\n',
    async () => { throw new Error('boom'); },
  );
  assert.deepEqual(out, []);
  assert.match(err, /boom/);
});
