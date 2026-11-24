// 초급 롤플레이 starter 도움 점검 스크립트 (fix-beginner-support 작업용)
// 실행: node --import ./scripts/ts-register.mjs scripts/support-check.mjs <repro|scenes|verify> [--max=N]
// - /api/chat 핸들러를 직접 불러 starter를 받고, 화면(RoleplaySupportPanel)과 같은 순서로 검사해 실패를 분류함
// - 호출 간격 3초, 429는 60초 뒤 1회만 재시도. 이 작업 전용 누적 카운터: eval-out/_calls-fix-beginner.json
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
const { default: handler } = await import('../api/chat.ts');
const meta = await import('../src/utils/meta.ts');
const { SERVER_SCENES } = await import('../api/_lib/scenes.ts');

const OUT = 'eval-out';
mkdirSync(OUT, { recursive: true });
const CALLS = path.join(OUT, '_calls-fix-beginner.json');
const args = Object.fromEntries(process.argv.slice(3).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const mode = process.argv[2];
let calls = existsSync(CALLS) ? JSON.parse(readFileSync(CALLS, 'utf8')).count : 0;
const cap = calls + Number(args.max ?? 9);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function invoke(body) {
  const chunks = [];
  const res = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(b) { this.payload = b; return this; }, setHeader() {}, write(s) { chunks.push(s); }, end() { return this; } };
  await handler({ method: 'POST', body }, res);
  if (res.payload) return { status: res.statusCode, error: res.payload.error, text: '' };
  let text = ''; let err = null;
  for (const p of chunks.join('').split('\n\n')) { const t = p.trim(); if (!t.startsWith('data: ')) continue; const e = JSON.parse(t.slice(6)); if (e.type === 'delta') text += e.text; if (e.type === 'error') err = e.error; }
  return { status: err ? 500 : 200, text, error: err };
}
async function api(body) {
  if (calls >= cap) throw new Error(`이번 실행 호출 한도 도달 (${calls})`);
  await sleep(3000);
  calls++; writeFileSync(CALLS, JSON.stringify({ count: calls }));
  let r = await invoke(body);
  if (r.status === 429) {
    console.warn('429 → 60초 대기 후 1회 재시도'); await sleep(60000);
    if (calls >= cap) throw new Error('호출 한도 도달');
    calls++; writeFileSync(CALLS, JSON.stringify({ count: calls }));
    r = await invoke(body);
    if (r.status === 429) throw new Error('429 두 번 연속 → 중단');
  }
  return r;
}

/** 화면(RoleplaySupportPanel.fetchOnce)과 같은 순서로 검사하고 실패를 분류 */
function classify(r, history) {
  if (r.status !== 200) return { kind: 'http', detail: `${r.status} ${r.error ?? ''}` };
  const parsed = meta.extractSupport(r.text, 'starter');
  if (!parsed.ok) return { kind: parsed.kind === 'schema' ? `schema:${parsed.error}` : parsed.kind, detail: parsed.error };
  const target = history[history.length - 1].content;
  if (!meta.replyToMatches(parsed.data.replyTo, target)) return { kind: 'replyTo', detail: parsed.data.replyTo };
  const level = meta.beginnerSupportIssue(parsed.data);
  if (level) {
    const k = /어휘|명사/.test(level) ? '초급 어휘·명사 검사' : /어절|문장 수/.test(level) ? '길이 검사' : '초급 범위(문형 등)';
    return { kind: k, detail: level, data: parsed.data };
  }
  const repeat = meta.repeatsLearner(parsed.data, history.filter((m) => m.role === 'user').map((m) => m.content));
  if (repeat) return { kind: 'repeat', detail: repeat, data: parsed.data };
  return { kind: 'ok', data: parsed.data };
}
const brief = (d) => d ? { intent: d.intent, frame: d.frame?.template, choices: d.choices?.options.map((o) => `${o.verdict[0]}:${o.text}`) } : null;

const REPRO = [
  { role: 'assistant', content: '네, 한빛상사 최민수입니다.' },
  { role: 'user', content: '안녕하세요. 저는 미래전자 직원이에요.' },
  { role: 'assistant', content: '네, 안녕하세요. 무슨 일이세요?' },
];
const out = [];
try {
  if (mode === 'repro' || mode === 'verify') {
    const n = Number(args.n ?? 3);
    for (let i = 1; i <= n; i++) {
      const r = await api({ mode: 'roleplay_support', sceneId: 'client-postpone', level: '초급', supportType: 'starter', messages: REPRO });
      const c = classify(r, REPRO);
      writeFileSync(path.join(OUT, `FB-${mode}-client-postpone-${i}.txt`), r.text);
      out.push({ id: `${mode}-${i}`, kind: c.kind, detail: c.detail, ...brief(c.data) });
    }
  }
  if (mode === 'scenes' || (mode === 'verify' && args.scenes)) {
    const ids = args.scenes && args.scenes !== true ? String(args.scenes).split(',') : Object.keys(SERVER_SCENES);
    for (const id of ids) {
      const history = [{ role: 'assistant', content: SERVER_SCENES[id].openingLineBeginner }];
      const r = await api({ mode: 'roleplay_support', sceneId: id, level: '초급', supportType: 'starter', messages: history });
      const c = classify(r, history);
      writeFileSync(path.join(OUT, `FB-${mode}-${id}-opening.txt`), r.text);
      out.push({ id, opening: history[0].content, kind: c.kind, detail: c.detail, ...brief(c.data) });
    }
  }
} catch (e) {
  console.warn('중단:', e.message);
}
console.log(JSON.stringify(out, null, 1));
console.log(`이 작업 API 누적: ${calls}`);
