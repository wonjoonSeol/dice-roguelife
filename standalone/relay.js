import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { readLines } from './lines.js';

const CEILING = 2000000; // bytes, for a prompt and for a reply
export const apiError = (code, message) => Object.assign(new Error(message), { code });
// what every provider needs of a request: a model, a prompt, and a prompt within the byte limit
function checkPrompt(config, prompt) {
  if (
    !config ||
    typeof prompt !== 'string' ||
    !prompt.trim() ||
    typeof config.model !== 'string' ||
    !config.model.trim()
  )
    throw apiError('invalid_config', 'A model and prompt are required.');
  if (Buffer.byteLength(prompt) > Math.min(Number(config.promptBytes) || 200000, CEILING))
    throw apiError('prompt_too_large', 'The prompt exceeds your configured byte limit. Reduce recent memory.');
}
const maxTokens = config => Math.max(64, Math.min(65536, Number(config.maxTokens) || 4096));

export function providerRequest({ config, apiKey = '', prompt, image, json = false }) {
  checkPrompt(config, prompt);
  const protocol = config.protocol || 'compatible';
  if (!['openai', 'compatible', 'anthropic', 'gemini', 'azure', 'perplexity'].includes(protocol))
    throw apiError('invalid_config', 'Unknown API protocol.');
  let endpoint;
  try {
    endpoint = new URL(config.endpoint);
  } catch {
    throw apiError('invalid_config', 'Enter a valid API base URL.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback))
  )
    throw apiError('invalid_config', 'Use HTTPS, or HTTP for a local model server.');
  if (!apiKey && !loopback) throw apiError('not_granted', 'An API key is required for this endpoint.');
  const max = maxTokens(config);
  const stream = config.stream !== false;
  const headers = { 'Content-Type': 'application/json' };
  let url = endpoint.href.replace(/\/$/, ''),
    body;
  if (protocol === 'anthropic') {
    url += '/messages';
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = { model: config.model, max_tokens: max, stream, messages: [{ role: 'user', content: prompt }] };
  } else if (protocol === 'gemini') {
    url += `/models/${encodeURIComponent(config.model.replace(/^models\//, ''))}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    headers['x-goog-api-key'] = apiKey;
    body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: max } };
    if (json && config.jsonMode) body.generationConfig.responseMimeType = 'application/json';
  } else {
    if (protocol === 'azure') {
      url += `/openai/deployments/${encodeURIComponent(config.model)}/chat/completions?api-version=${encodeURIComponent(config.apiVersion || '2024-10-21')}`;
      headers['api-key'] = apiKey;
    } else {
      url += protocol === 'perplexity' ? '/v1/sonar' : '/chat/completions';
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    }
    body = { model: config.model, stream, messages: [{ role: 'user', content: prompt }] };
    body[protocol === 'openai' || protocol === 'azure' ? 'max_completion_tokens' : 'max_tokens'] = max;
    if (json && config.jsonMode && !/json array/i.test(prompt)) body.response_format = { type: 'json_object' };
    if (stream && (protocol === 'openai' || config.provider === 'openrouter'))
      body.stream_options = { include_usage: true };
  }
  if (image) {
    if (
      !config.vision ||
      !/^image\/(png|jpeg|webp|gif)$/.test(image.type) ||
      typeof image.data !== 'string' ||
      image.data.length > 11000000 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(image.data)
    )
      throw apiError('invalid_config', 'Invalid image attachment or image analysis is disabled.');
    if (protocol === 'anthropic')
      body.messages[0].content = [
        { type: 'image', source: { type: 'base64', media_type: image.type, data: image.data } },
        { type: 'text', text: prompt },
      ];
    else if (protocol === 'gemini')
      body.contents[0].parts.push({ inlineData: { mimeType: image.type, data: image.data } });
    else
      body.messages[0].content = [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:${image.type};base64,${image.data}` } },
      ];
  }
  return { url, headers, body, protocol, stream };
}

export function normalizeEvent(protocol, value, streamed = true) {
  if (value.error || value.type === 'error')
    throw apiError('provider_error', 'The provider reported a stream error. Check the model and connection settings.');
  if (protocol === 'anthropic') {
    const usage = value.usage || value.message?.usage;
    // cached prompt tokens are counted apart from input_tokens (Claude Code always caches)
    const cached = (usage?.cache_creation_input_tokens || 0) + (usage?.cache_read_input_tokens || 0);
    return {
      text: streamed
        ? value.delta?.text || ''
        : (value.content || [])
            .filter(p => p.type === 'text')
            .map(p => p.text)
            .join(''),
      model: value.model || value.message?.model,
      usage: usage && { input: usage.input_tokens + cached, output: usage.output_tokens },
      refused: value.delta?.stop_reason === 'refusal' || value.stop_reason === 'refusal',
      truncated: value.delta?.stop_reason === 'max_tokens' || value.stop_reason === 'max_tokens',
      complete: value.type === 'message_stop' || !streamed,
    };
  }
  if (protocol === 'gemini') {
    const candidate = value.candidates?.[0];
    return {
      text: (candidate?.content?.parts || [])
        .filter(p => !p.thought && p.text)
        .map(p => p.text)
        .join(''),
      model: value.modelVersion,
      usage: value.usageMetadata && {
        input: value.usageMetadata.promptTokenCount,
        output: value.usageMetadata.candidatesTokenCount,
      },
      refused:
        !!value.promptFeedback?.blockReason ||
        ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT'].includes(candidate?.finishReason),
      truncated: candidate?.finishReason === 'MAX_TOKENS',
      complete: !!candidate?.finishReason || !streamed,
    };
  }
  const choice = value.choices?.[0],
    message = streamed ? choice?.delta : choice?.message;
  return {
    text: typeof message?.content === 'string' ? message.content : '',
    model: value.model,
    usage: value.usage && { input: value.usage.prompt_tokens, output: value.usage.completion_tokens },
    refused: !!message?.refusal || choice?.finish_reason === 'content_filter',
    truncated: choice?.finish_reason === 'length',
    complete: !!choice?.finish_reason || !streamed,
  };
}

export async function readSSE(body, onValue) {
  let data = [];
  const line = text => {
    if (!text) {
      if (data.length) {
        const payload = data.join('\n');
        data = [];
        if (payload !== '[DONE]') onValue(JSON.parse(payload));
      }
    } else if (text.startsWith('data:')) data.push(text.slice(5).replace(/^ /, ''));
  };
  await readLines(body, line);
  line('');
}

export function httpError(status, data = '') {
  let code =
    status === 401 || status === 403
      ? 'not_granted'
      : status === 429
        ? 'rate_limited'
        : status === 402
          ? 'insufficient_credit'
          : status >= 500
            ? 'provider_unavailable'
            : 'invalid_request';
  // Gemini answers a bad key with 400, and an unknown model (on every provider) comes back as 404
  return apiError(textCode(data) ?? (status === 404 ? 'no_model' : code), `HTTP ${status}`);
}
// what an error's text says, first match wins: from an HTTP body, or from Claude Code's result
const TEXT_CODES = [
  [/insufficient_quota|insufficient.*(balance|credit)|credit balance/i, 'insufficient_credit'],
  [/context_length|context window|too many tokens|prompt is too long/i, 'prompt_too_large'],
  [/API_KEY_INVALID|API key not valid|invalid.{0,10}api.?key/i, 'not_granted'],
  [/model.{0,80}(not found|does not exist|not supported)/i, 'no_model'],
];
// Claude Code's own wording, tried first: its usage limits reset, so they are no credit failure
const CLI_CODES = [
  [/rate.?limit|usage limit|limit reached|overloaded/i, 'rate_limited'],
  [/not logged in|\/login|authenticat|oauth/i, 'not_granted'],
  [/selected model/i, 'no_model'],
  [/output token maximum/i, 'output_limit'],
  [/unknown option|unknown argument/i, 'old_cli'],
];
const textCode = (text, list = TEXT_CODES) => list.find(([re]) => re.test(text))?.[1];

// a provider's events, normalized and checked, passed on as text; finish() sends the end
function collector(protocol, emit, model) {
  let usage = {},
    complete = false,
    size = 0;
  const receive = (value, streamed = true) => {
    const e = normalizeEvent(protocol, value, streamed);
    if (e.refused) throw apiError('refused', 'The provider refused this request.');
    if (e.truncated) throw apiError('output_limit', 'The reply hit the output limit. Increase it in Settings.');
    complete ||= e.complete;
    if (e.model) model = e.model;
    if (e.usage) for (const k of ['input', 'output']) if (Number.isFinite(e.usage[k])) usage[k] = e.usage[k];
    if (e.text) {
      size += Buffer.byteLength(e.text);
      if (size > CEILING) throw apiError('output_limit', 'The reply is too large.');
      emit({ text: e.text });
    }
  };
  const finish = () => {
    if (!complete || !size) throw apiError('provider_error', 'The provider returned an empty or incomplete reply.');
    emit({ done: true, model, usage });
  };
  return { receive, finish };
}

// The "Claude Code" provider: narration runs through the claude command on this computer (claude -p), which brings its
// own login, or the profile's API key when it has one. There is no endpoint, and the command is always plain "claude".
const CLI_SYSTEM =
  'You are the narrator of a text roleplaying game. Follow the instructions in the user message exactly.';
export async function claudeSample({ config, apiKey = '', prompt, image }, emit, signal, spawner = spawn) {
  checkPrompt(config, prompt);
  if (image) throw apiError('invalid_config', 'Image analysis is not available through Claude Code.');
  // no tools, settings, skills or CLAUDE.md files: Claude Code is only the model here, and the player's own setup
  // must not leak into the narration
  const args = [
    ...['-p', '--model', config.model, '--system-prompt', CLI_SYSTEM, '--no-session-persistence'],
    ...['--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
    ...['--tools', '', '--setting-sources', '', '--disable-slash-commands', '--strict-mcp-config'],
  ];
  const child = spawner('claude', args, {
    cwd: tmpdir(),
    signal,
    windowsHide: true,
    env: {
      ...process.env,
      ...(apiKey && { ANTHROPIC_API_KEY: apiKey }), // this profile's own key, for the claude command only
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(maxTokens(config)),
      CLAUDE_CODE_DISABLE_CLAUDE_MDS: '1',
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  });
  const exited = new Promise((resolve, reject) => {
    child.once('error', e => {
      const code = e.name === 'AbortError' ? 'cancelled' : e.code === 'ENOENT' ? 'no_cli' : 'provider_error';
      reject(apiError(code, 'claude'));
    });
    child.once('close', resolve);
  });
  let stderr = ''; // read for a failure before any result (an older claude that rejects an option)
  child.stderr.on('data', d => (stderr = (stderr + d).slice(-4000)));
  child.stdin.on('error', () => {});
  child.stdin.end(prompt);
  const reply = collector('anthropic', emit, config.model); // Claude Code streams the Messages API's own events
  let result = null;
  try {
    await Promise.all([
      exited,
      readLines(Readable.toWeb(child.stdout), line => {
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          return; // not an event
        }
        if (e.type === 'stream_event') reply.receive(e.event);
        else if (e.type === 'result') {
          result = e;
          child.kill(); // the last event: the reply needn't wait for claude to exit
        }
      }),
    ]);
  } finally {
    child.kill();
  }
  if (!result) throw apiError(textCode(stderr, CLI_CODES) ?? 'provider_error', 'claude');
  if (result.is_error) {
    const text = String(result.result);
    throw apiError(textCode(text, CLI_CODES) ?? textCode(text) ?? 'provider_error', 'claude');
  }
  reply.finish();
}

export async function relaySample(input, emit, signal, fetcher = fetch) {
  if (input.config?.protocol === 'claude-cli') return claudeSample(input, emit, signal);
  const request = providerRequest(input);
  const retries = Math.max(0, Math.min(2, Number(input.config.retries) || 0));
  const body = JSON.stringify(request.body);
  let response;
  for (let attempt = 0; attempt <= retries; attempt++) {
    response = await fetcher(request.url, {
      method: 'POST',
      headers: request.headers,
      body,
      signal,
      redirect: 'error',
    });
    if (response.ok) break;
    const failure = httpError(response.status, await response.text());
    if (attempt === retries || !['rate_limited', 'provider_unavailable'].includes(failure.code)) throw failure;
    await sleep(Math.min(1000 * 2 ** attempt, 4000), undefined, { signal }).catch(() => {
      throw apiError('cancelled', 'Cancelled');
    });
  }
  const reply = collector(request.protocol, emit, input.config.model);
  if (request.stream && response.headers.get('content-type')?.includes('text/event-stream'))
    await readSSE(response.body, value => reply.receive(value));
  else reply.receive(await response.json(), false);
  reply.finish();
}
