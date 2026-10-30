import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerRequest, normalizeEvent, readSSE, relaySample, httpError, claudeSample } from '../relay.js';
import { lanAddresses, localOnly } from '../server.js';
import { hostStatus, openServer } from './support.js';

const input = (protocol = 'compatible', extra = {}) => ({
  config: { protocol, endpoint: 'https://example.com/v1', model: 'test-model', maxTokens: 512, ...extra },
  apiKey: 'secret-test-key',
  prompt: 'Return JSON',
  json: true,
});
test('dedicated protocols, authentication, JSON opt-in and Azure deployment URLs', () => {
  const openai = providerRequest(input('openai'));
  assert.equal(openai.body.max_completion_tokens, 512);
  assert.equal(openai.headers.Authorization, 'Bearer secret-test-key');
  assert.equal(openai.body.response_format, undefined);
  assert.deepEqual(providerRequest(input('compatible', { jsonMode: true })).body.response_format, {
    type: 'json_object',
  });
  const anthropic = providerRequest(input('anthropic'));
  assert.equal(anthropic.headers['x-api-key'], 'secret-test-key');
  assert.equal(anthropic.body.max_tokens, 512);
  const gemini = providerRequest(input('gemini', { jsonMode: true }));
  assert.equal(gemini.headers['x-goog-api-key'], 'secret-test-key');
  assert.equal(gemini.body.generationConfig.responseMimeType, 'application/json');
  assert.match(gemini.url, /:streamGenerateContent\?alt=sse$/);
  assert.match(
    providerRequest(input('azure', { model: 'deployment name' })).url,
    /deployments\/deployment%20name\/chat\/completions\?api-version=/,
  );
});
test('local keyless models, rejected insecure URLs and prompt limits', () => {
  const local = input('compatible', { endpoint: 'http://localhost:11434/v1' });
  local.apiKey = '';
  assert.equal(providerRequest(local).headers.Authorization, undefined);
  for (const endpoint of [
    'http://example.com/v1',
    'https://user:pass@example.com/v1',
    'https://example.com/v1?key=secret',
  ])
    assert.throws(() => providerRequest(input('compatible', { endpoint })), { code: 'invalid_config' });
  assert.throws(() => providerRequest(input('compatible', { promptBytes: 2 })), { code: 'prompt_too_large' });
});
test('vision attachments use each native format and require opt-in', () => {
  const image = { type: 'image/png', data: 'YQ==' };
  assert.throws(() => providerRequest({ ...input(), image }), { code: 'invalid_config' });
  const compatible = providerRequest({ ...input('compatible', { vision: true }), image });
  assert.equal(compatible.body.messages[0].content[1].image_url.url, 'data:image/png;base64,YQ==');
  const anthropic = providerRequest({ ...input('anthropic', { vision: true }), image });
  assert.equal(anthropic.body.messages[0].content[0].source.data, 'YQ==');
  const gemini = providerRequest({ ...input('gemini', { vision: true }), image });
  assert.equal(gemini.body.contents[0].parts[1].inlineData.mimeType, 'image/png');
  assert.match(providerRequest(input('perplexity')).url, /\/v1\/sonar$/);
});
test('fragmented SSE decodes Unicode, CRLF and final events', async () => {
  const bytes = new TextEncoder().encode('data: {"text":"안녕"}\r\n\r\ndata: {"last":true}\n\ndata: [DONE]\n\n');
  const stream = new ReadableStream({
    start(c) {
      for (const b of bytes) c.enqueue(Uint8Array.of(b));
      c.close();
    },
  });
  const values = [];
  await readSSE(stream, v => values.push(v));
  assert.deepEqual(values, [{ text: '안녕' }, { last: true }]);
});
test('normalization excludes reasoning and detects refusals and truncation', () => {
  assert.equal(
    normalizeEvent('gemini', {
      candidates: [{ content: { parts: [{ text: 'private', thought: true }, { text: 'story' }] } }],
    }).text,
    'story',
  );
  assert.equal(normalizeEvent('anthropic', { delta: { text: 'story' } }).text, 'story');
  assert.equal(normalizeEvent('compatible', { choices: [{ delta: { refusal: 'no' } }] }).refused, true);
  assert.equal(normalizeEvent('compatible', { choices: [{ finish_reason: 'length' }] }).truncated, true);
});
test('relay streams text and usage, handles non-streaming servers, and bounds retries', async () => {
  const emitted = [];
  await relaySample(
    input(),
    e => emitted.push(e),
    new AbortController().signal,
    async () =>
      new Response(
        'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\ndata: [DONE]\n\n',
        { headers: { 'Content-Type': 'text/event-stream' } },
      ),
  );
  assert.equal(emitted[0].text, 'hello');
  assert.deepEqual(emitted[1].usage, { input: 10, output: 2 });
  const normal = [];
  await relaySample(
    input(),
    e => normal.push(e),
    new AbortController().signal,
    async () => Response.json({ choices: [{ message: { content: 'normal' }, finish_reason: 'stop' }] }),
  );
  assert.equal(normal[0].text, 'normal');
  let calls = 0;
  await assert.rejects(
    relaySample(
      input(),
      () => {},
      new AbortController().signal,
      async () => {
        calls++;
        return new Response('no', { status: 429 });
      },
    ),
    { code: 'rate_limited' },
  );
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    relaySample(
      input('compatible', { retries: 1 }),
      () => {},
      new AbortController().signal,
      async () => {
        calls++;
        return new Response('no', { status: 503 });
      },
    ),
    { code: 'provider_unavailable' },
  );
  assert.equal(calls, 2);
});
test('incomplete streams and output limits do not commit successful replies', async () => {
  for (const finish of ['', ',"finish_reason":"length"']) {
    const events = [];
    await assert.rejects(
      relaySample(
        input(),
        e => events.push(e),
        new AbortController().signal,
        async () =>
          new Response(`data: {"choices":[{"delta":{"content":"partial"}${finish}}]}\n\n`, {
            headers: { 'Content-Type': 'text/event-stream' },
          }),
      ),
    );
    assert.equal(
      events.some(e => e.done),
      false,
    );
  }
  assert.equal(httpError(429, 'insufficient_quota').code, 'insufficient_credit');
  // Gemini: a bad key is a 400, an unknown model a 404
  assert.equal(
    httpError(400, '{"error":{"message":"API key not valid. Please pass a valid API key."}}').code,
    'not_granted',
  );
  assert.equal(httpError(404, '{"error":{"message":"models/x is not found for API version v1beta"}}').code, 'no_model');
  assert.equal(httpError(400, '{"error":{"message":"Invalid JSON payload"}}').code, 'invalid_request');
});
test('cancellation reaches upstream fetch', async () => {
  const c = new AbortController();
  const promise = relaySample(
    input(),
    () => {},
    c.signal,
    async (url, { signal }) =>
      new Promise((resolve, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }),
      ),
  );
  c.abort();
  await assert.rejects(promise, { name: 'AbortError' });
});
test('bind 0.0.0.0: an IP Host on this port gets in, never a name or a dressed-up address', async () => {
  const s = await openServer({ bind: '0.0.0.0' });
  try {
    const port = Number(new URL(s.url).port);
    assert.equal(await hostStatus(s.url, `192.168.0.114:${port}`), 200);
    for (const host of [
      `192.168.0.114:${port + 1}`,
      `my-pc.lan:${port}`,
      `evil.example@192.168.0.114:${port}`,
      `0x7f000001:${port}`,
      `192.168.0.114.:${port}`,
    ])
      assert.equal(await hostStatus(s.url, host), 403, host);
  } finally {
    await s.stop();
  }
});
// the network, for real: this machine opening itself by its own address (a second device can't be played here)
const [lanIp] = lanAddresses();
test('bind 0.0.0.0: the game by IP, from a page on that address', { skip: !lanIp }, async () => {
  const s = await openServer({ bind: '0.0.0.0' });
  const base = s.url.replace('127.0.0.1', lanIp);
  const post = async (path, body, origin = base) => (await s.call(path, body, { Origin: origin }, base)).status;
  try {
    assert.equal((await fetch(base)).status, 200);
    assert.deepEqual(await (await s.call('/api/sample', '{}', { Origin: base }, base)).json(), {
      code: 'not_configured',
    });
    assert.equal(await post('/api/sample', '{}', `http://10.255.255.1:${new URL(base).port}`), 403);
    assert.equal(await post('/api/server/set', {}), 200, 'this computer, by its own address');
  } finally {
    await s.stop();
  }
});
test('settings and AI connections change only from this computer', () => {
  const route = localOnly(() => 'done');
  const from =
    (remoteAddress, localAddress = '192.168.0.114') =>
    () =>
      route({ socket: { remoteAddress, localAddress } });
  assert.equal(from('127.0.0.1', '127.0.0.1')(), 'done');
  assert.equal(from('192.168.0.114')(), 'done', 'this computer by its own address');
  assert.throws(from('192.168.0.50'), { code: 'local_only' }, 'another device');
  assert.throws(from('10.8.0.2', '10.8.0.1'), { code: 'local_only' }, 'a phone over WireGuard');
});
test('local relay rejects missing token, foreign origins and rebinding hosts', async () => {
  const s = await openServer({ hosts: ['my-pc.tailnet.ts.net'] });
  try {
    assert.equal((await fetch(s.url + '/api/sample', { method: 'POST', body: '{}' })).status, 403);
    const foreign = await s.call('/api/sample', '{}', { Origin: 'https://attacker.example' });
    assert.equal(foreign.status, 403);
    assert.equal(await foreign.text(), '', 'a foreign origin learns nothing');
    assert.equal(await hostStatus(s.url, 'attacker.example'), 403);
    assert.equal(s.server.address().address, '127.0.0.1', 'by default, this computer only');
    assert.equal(await hostStatus(s.url, `192.168.0.114:${new URL(s.url).port}`), 403, 'an IP Host needs bind');
    // a name in hosts (a Tailscale address) is let in, from its own https origin
    assert.equal(await hostStatus(s.url, 'my-pc.tailnet.ts.net'), 200);
    assert.equal((await s.call('/api/sample', '{}', { Origin: 'https://my-pc.tailnet.ts.net' })).status, 400);
    assert.deepEqual(await (await s.call('/api/sample', '{}')).json(), { code: 'not_configured' });
  } finally {
    await s.stop();
  }
});

// stand-ins for the claude command: node running a script, started with the options the relay gave
const fakeClaude = (script, seen) => (cmd, args, options) => {
  seen?.push({ cmd, args, options });
  return spawn(process.execPath, ['-e', script], options);
};
// prints these stream-json lines once stdin ends, then exits (with linger, 3 seconds later)
const printing = (lines, linger = false) =>
  `process.stdin.resume().on('end',()=>{process.stdout.write(${JSON.stringify(
    lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n',
  )});${linger ? 'setTimeout(()=>{},3000)' : ''}})`;
const event = e => ({ type: 'stream_event', event: e });
const usage = { input_tokens: 2, cache_read_input_tokens: 8 };
const start = model => event({ type: 'message_start', message: { model, usage: { ...usage, output_tokens: 1 } } });
const delta = text => event({ type: 'content_block_delta', delta: { type: 'text_delta', text } });
const stopped = (stop_reason = 'end_turn') => [
  event({ type: 'message_delta', delta: { stop_reason }, usage: { ...usage, output_tokens: 5 } }),
  event({ type: 'message_stop' }),
];
const result = (extra = {}) => ({ type: 'result', is_error: false, result: 'ok', ...extra });
const reply = [delta('x'), ...stopped()];
const cliInput = extra => ({ ...input('claude-cli', { model: 'sonnet', ...extra }), apiKey: '' });
const cliRun = async (input, script, seen) => {
  const emitted = [];
  await claudeSample(input, e => emitted.push(e), new AbortController().signal, fakeClaude(script, seen));
  return emitted;
};
test('claude -p: streams text and usage, runs without tools or the player setup, under the output limit', async () => {
  const seen = [];
  const lines = [start('claude-sonnet-x'), delta('안'), delta('녕'), ...stopped(), 'not json', result()];
  const emitted = await cliRun(cliInput(), printing(lines), seen);
  assert.deepEqual(emitted, [
    { text: '안' },
    { text: '녕' },
    { done: true, model: 'claude-sonnet-x', usage: { input: 10, output: 5 } },
  ]);
  const { cmd, args, options } = seen[0];
  assert.equal(cmd, 'claude');
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet');
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.equal(args[args.indexOf('--setting-sources') + 1], '');
  assert.ok(args.includes('--no-session-persistence'));
  assert.equal(options.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS, '1');
  assert.equal(options.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS, '512');
});
test('claude -p: the prompt goes on stdin, and the reply ends at the result while claude still runs', async () => {
  const echo = `let t='';process.stdin.on('data',d=>t+=d).on('end',()=>{const ev=event=>console.log(JSON.stringify({type:'stream_event',event}));ev({type:'content_block_delta',delta:{type:'text_delta',text:t}});ev({type:'message_stop'});console.log(JSON.stringify({type:'result',is_error:false}))})`;
  const emitted = await cliRun({ ...cliInput(), prompt: '이야기를 들려줘' }, echo);
  assert.equal(emitted[0].text, '이야기를 들려줘');
  const began = Date.now();
  const lingering = await cliRun(cliInput(), printing([...reply, result()], true));
  assert.equal(lingering.at(-1).done, true);
  assert.ok(Date.now() - began < 2000, 'waited for claude to exit');
});
test('claude -p: a profile key goes to the command only, and a keyless profile inherits the environment', async () => {
  const seen = [];
  await cliRun({ ...cliInput(), apiKey: 'sk-profile' }, printing([...reply, result()]), seen);
  assert.equal(seen[0].options.env.ANTHROPIC_API_KEY, 'sk-profile');
  const before = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-from-env';
  try {
    await cliRun(cliInput(), printing([...reply, result()]), seen);
    assert.equal(seen[1].options.env.ANTHROPIC_API_KEY, 'sk-from-env');
  } finally {
    if (before === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = before;
  }
});
test('claude -p: failures map to the game error codes', async () => {
  const fail = text => cliRun(cliInput(), printing([result({ is_error: true, result: text })]));
  const cases = [
    ['Credit balance is too low', 'insufficient_credit'],
    ['Invalid API key. Fix external API key', 'not_granted'], // the CLI's words for a bad key
    ['Not logged in. Please run /login', 'not_granted'],
    ['Rate limit reached for requests', 'rate_limited'],
    ['Claude usage limit reached. Your limit will reset at 5pm', 'rate_limited'],
    ['There is an issue with the selected model (x)', 'no_model'],
    ["Claude's response exceeded the 64 output token maximum", 'output_limit'],
    ['Prompt is too long', 'prompt_too_large'],
    ['Failed to load the context of a plugin', 'provider_error'],
  ];
  await Promise.all(cases.map(([text, code]) => assert.rejects(fail(text), { code }, text)));
  const run = lines => cliRun(cliInput(), printing(lines));
  await Promise.all([
    assert.rejects(run([delta('x'), ...stopped('refusal'), result()]), { code: 'refused' }),
    assert.rejects(run([delta('x'), ...stopped('max_tokens'), result()]), { code: 'output_limit' }),
    assert.rejects(run([delta('x'), result()]), { code: 'provider_error' }), // no message_stop
    assert.rejects(run([delta('partial')]), { code: 'provider_error' }), // no result
    // an older claude without one of the options
    assert.rejects(cliRun(cliInput(), `process.stderr.write("error: unknown option '--tools'\n");process.exit(1)`), {
      code: 'old_cli',
    }),
    assert.rejects(
      claudeSample(
        cliInput(),
        () => {},
        new AbortController().signal,
        (cmd, args, options) => spawn('claude-does-not-exist-xyz', args, options),
      ),
      { code: 'no_cli' },
    ),
  ]);
});
test('claude -p: the relay sends it the request, and checks it like any other', async () => {
  const signal = new AbortController().signal;
  const image = { type: 'image/png', data: 'YQ==' };
  await assert.rejects(
    relaySample({ ...cliInput(), image }, () => {}, signal),
    { code: 'invalid_config' },
  );
  await assert.rejects(
    relaySample(cliInput({ promptBytes: 2 }), () => {}, signal),
    { code: 'prompt_too_large' },
  );
  await assert.rejects(
    relaySample(cliInput({ model: ' ' }), () => {}, signal),
    { code: 'invalid_config' },
  );
});
