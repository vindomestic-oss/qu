import './env';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiProvider } from '../lib/aiGrading/providers/gemini';
import { GRADER_SYSTEM_PROMPT } from '../lib/aiGrading/prompt';
import type { GradePayload } from '../lib/aiGrading/types';

// Wish 7, layer B (S14): the Gemini adapter's request and response mapping, with a mocked fetch.
// No network: every test injects fetchImpl, and sleeps are recorded instead of waited.

const KEY = 'AIzaSy-test-key-never-real';
const payload: GradePayload = {
  quiz: 'European Chidon HaTanach - Bible (Tanakh) knowledge quiz for Jewish youth',
  question: 'Who was the first child Avraham circumcised?',
  reference_answer: 'Yishmael',
  accepted_answers: ['Yishmael', 'Ishmael'],
  grader_notes: null,
  max_points: 1,
  near_match_hint: null,
  student_answer: 'Измаил',
};

interface Call {
  url: string;
  init: RequestInit;
}

function mockFetch(responses: (Response | Error | 'hang')[]) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (next === undefined) throw new Error('no more mocked responses');
    if (next === 'hang') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { calls, impl };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const success = (output: unknown, extra: Record<string, unknown> = {}) =>
  json({
    candidates: [{ content: { role: 'model', parts: [{ text: typeof output === 'string' ? output : JSON.stringify(output) }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 812, candidatesTokenCount: 41, thoughtsTokenCount: 120, totalTokenCount: 973 },
    modelVersion: 'gemini-2.5-flash-002',
    responseId: 'resp-abc',
    ...extra,
  });

const GOOD = { rationale: 'Измаил is the Russian name of Yishmael.', verdict: 'correct', confidence: 'high', injection_suspected: false, answer_language: 'ru' };

function provider(responses: (Response | Error | 'hang')[], opts: { timeoutMs?: number; maxRetries?: number } = {}) {
  const m = mockFetch(responses);
  const sleeps: number[] = [];
  const p = createGeminiProvider({
    apiKey: KEY,
    model: 'gemini-2.5-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/',
    timeoutMs: opts.timeoutMs ?? 5_000,
    maxRetries: opts.maxRetries,
    fetchImpl: m.impl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { p, calls: m.calls, sleeps };
}

describe('Gemini adapter', () => {
  test('request: generateContent with the key in a header, the system prompt and ONE user message with the payload', async () => {
    const { p, calls } = provider([success(GOOD)]);
    await p.grade(payload);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    assert.equal(calls[0].url.includes(KEY), false, 'the key is never in the URL');
    assert.equal(calls[0].init.method, 'POST');
    const headers = calls[0].init.headers as Record<string, string>;
    assert.equal(headers['x-goog-api-key'], KEY);
    const body = JSON.parse(String(calls[0].init.body));
    assert.deepEqual(body.systemInstruction, { parts: [{ text: GRADER_SYSTEM_PROMPT }] });
    assert.equal(body.contents.length, 1);
    assert.equal(body.contents[0].role, 'user');
    assert.equal(body.contents[0].parts.length, 1);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), payload, 'exactly the payload');
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(body.generationConfig.responseSchema.required, ['rationale', 'verdict', 'confidence', 'injection_suspected', 'answer_language']);
    assert.deepEqual(body.generationConfig.responseSchema.properties.verdict.enum, ['correct', 'partially_correct', 'incorrect', 'unclear']);
    assert.equal('temperature' in body.generationConfig, false);
    assert.ok(body.safetySettings.every((s: { threshold: string }) => s.threshold === 'BLOCK_ONLY_HIGH'));
  });

  test('response: the parsed result, usage (thinking tokens count as output), served model and response id', async () => {
    const { p } = provider([success({ ...GOOD, verdict: 'CORRECT', confidence: ' High ', rationale: 'x'.repeat(400), answer_language: 'russian-ru' })]);
    const out = await p.grade(payload);
    assert.equal(out.errorKind, undefined);
    assert.deepEqual(
      { ...out.result!, rationale: out.result!.rationale.length },
      { rationale: 300, verdict: 'correct', confidence: 'high', injection_suspected: false, answer_language: 'russian-' },
    );
    assert.deepEqual(out.usage, { inputTokens: 812, outputTokens: 161 });
    assert.equal(out.servedModel, 'gemini-2.5-flash-002');
    assert.equal(out.requestId, 'resp-abc');
    assert.equal(out.stopReason, 'STOP');
  });

  test('thought parts are ignored; only the answer text is parsed', async () => {
    const r = json({
      candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: JSON.stringify(GOOD) }] }, finishReason: 'STOP' }],
    });
    const { p } = provider([r]);
    assert.equal((await p.grade(payload)).result?.verdict, 'correct');
  });

  test('malformed output: not JSON, wrong enum, missing field, no candidates, a non-JSON body', async () => {
    for (const r of [
      success('{"verdict": "correct"'),
      success({ ...GOOD, verdict: 'maybe' }),
      success({ ...GOOD, injection_suspected: 'no' }),
      success({ verdict: 'correct', confidence: 'high' }),
      json({ candidates: [] }),
      new Response('<html>oops</html>', { status: 200 }),
    ]) {
      const { p } = provider([r]);
      const out = await p.grade(payload);
      assert.equal(out.errorKind, 'malformed');
      assert.equal(out.result, undefined);
    }
  });

  test('safety: a blocked prompt and a safety stop are failures; MAX_TOKENS and other stops too', async () => {
    let out = await provider([json({ promptFeedback: { blockReason: 'SAFETY' } })]).p.grade(payload);
    assert.deepEqual([out.errorKind, out.stopReason], ['safety', 'blocked:SAFETY']);
    out = await provider([json({ candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }] })]).p.grade(payload);
    assert.deepEqual([out.errorKind, out.stopReason], ['safety', 'SAFETY']);
    out = await provider([json({ candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] })]).p.grade(payload);
    assert.equal(out.errorKind, 'safety');
    out = await provider([json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"rationale": "cut' }] } }] })]).p.grade(payload);
    assert.deepEqual([out.errorKind, out.stopReason], ['max_tokens', 'MAX_TOKENS']);
    out = await provider([json({ candidates: [{ finishReason: 'OTHER' }] })]).p.grade(payload);
    assert.equal(out.errorKind, 'other');
  });

  test('errors: invalid key and permission → auth, unknown model → config, other 4xx → bad_request; none retried', async () => {
    const invalidKey = json(
      { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.', details: [{ reason: 'API_KEY_INVALID' }] } },
      400,
    );
    let r = provider([invalidKey]);
    let out = await r.p.grade(payload);
    assert.equal(out.errorKind, 'auth');
    assert.equal(r.calls.length, 1);
    out = await provider([json({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'denied' } }, 403)]).p.grade(payload);
    assert.equal(out.errorKind, 'auth');
    out = await provider([json({ error: { code: 404, status: 'NOT_FOUND', message: 'models/gemini-x is not found' } }, 404)]).p.grade(payload);
    assert.equal(out.errorKind, 'config');
    r = provider([json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad schema' } }, 400)]);
    out = await r.p.grade(payload);
    assert.deepEqual([out.errorKind, out.stopReason, r.calls.length], ['bad_request', 'http_400', 1]);
  });

  test('429: retried twice honouring the server delay, then rate_limit; a later success is used', async () => {
    const limited = () =>
      json({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota', details: [{ retryDelay: '7s' }] } }, 429);
    let r = provider([limited(), limited(), limited()]);
    let out = await r.p.grade(payload);
    assert.equal(out.errorKind, 'rate_limit');
    assert.equal(r.calls.length, 3, 'one call and two retries');
    assert.deepEqual(r.sleeps, [7000, 7000]);
    r = provider([json({ error: { code: 429 } }, 429, { 'Retry-After': '120' }), success(GOOD)]);
    out = await r.p.grade(payload);
    assert.equal(out.result?.verdict, 'correct');
    assert.deepEqual(r.sleeps, [30_000], 'at most 30 s');
  });

  test('5xx and network errors are retried twice, then server / network', async () => {
    let r = provider([json({}, 503), json({}, 500), success(GOOD)]);
    assert.equal((await r.p.grade(payload)).result?.verdict, 'correct');
    assert.deepEqual(r.sleeps, [1000, 2000]);
    r = provider([json({}, 503), json({}, 503), json({}, 502)]);
    assert.equal((await r.p.grade(payload)).errorKind, 'server');
    r = provider([new TypeError('fetch failed'), new TypeError('fetch failed'), new TypeError('fetch failed')]);
    const out = await r.p.grade(payload);
    assert.equal(out.errorKind, 'network');
    assert.equal(r.calls.length, 3);
  });

  test('timeout: aborted after timeoutMs, not retried', async () => {
    const r = provider(['hang', success(GOOD)], { timeoutMs: 30 });
    const out = await r.p.grade(payload);
    assert.equal(out.errorKind, 'timeout');
    assert.equal(r.calls.length, 1);
  });

  test('the key never appears in an error, even when the server echoes it', async () => {
    const out = await provider([json({ error: { code: 400, status: 'INVALID_ARGUMENT', message: `Key ${KEY} rejected` } }, 400)]).p.grade(payload);
    assert.equal(JSON.stringify(out).includes(KEY), false);
    assert.ok(out.error!.includes('[key]'));
  });

  test('allowed() is checked before every attempt: nothing is sent once it says no, not even a retry', async () => {
    let r = provider([success(GOOD)]);
    let out = await r.p.grade(payload, { allowed: () => false });
    assert.deepEqual([out.errorKind, r.calls.length], ['aborted', 0]);
    let allow = true;
    const limited = json({ error: { code: 429, details: [{ retryDelay: '7s' }] } }, 429);
    r = provider([limited, success(GOOD)]);
    const p = r.p.grade(payload, { allowed: () => allow });
    // The switch goes off while the adapter waits before its retry.
    allow = false;
    out = await p;
    assert.deepEqual([out.errorKind, r.calls.length], ['aborted', 1], 'the retry was never sent');
  });

  test('an external abort stops a request on its way (aborted, not timeout) and is not retried', async () => {
    const controller = new AbortController();
    const r = provider(['hang', success(GOOD)], { timeoutMs: 5_000 });
    const p = r.p.grade(payload, { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    const out = await p;
    assert.deepEqual([out.errorKind, r.calls.length], ['aborted', 1]);
    const already = await provider([success(GOOD)]).p.grade(payload, { signal: controller.signal });
    assert.equal(already.errorKind, 'aborted');
  });

  test('maxRetries 0 (the worker): one request; 429 reports the delay the server asked for', async () => {
    const r = provider([json({ error: { code: 429, details: [{ retryDelay: '12s' }] } }, 429), success(GOOD)], { maxRetries: 0 });
    const out = await r.p.grade(payload);
    assert.deepEqual([out.errorKind, out.retryAfterMs, r.calls.length], ['rate_limit', 12_000, 1]);
    const r2 = provider([json({}, 503), success(GOOD)], { maxRetries: 0 });
    assert.deepEqual([(await r2.p.grade(payload)).errorKind, r2.calls.length], ['server', 1]);
  });
});
