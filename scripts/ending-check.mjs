// 롤플레이 대화 종료 점검 스크립트 (fix-roleplay-ending 작업용)
// 실행: node --import ./scripts/ts-register.mjs scripts/ending-check.mjs <repro|run> [--max=N]
// - /api/chat 핸들러를 직접 불러 확인. 호출 간격 3초, 429는 60초 뒤 1회만 재시도.
// - 이 작업 전용 누적 카운터: eval-out/_calls-fix-ending.json
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
const { default: handler } = await import('../api/chat.ts');
const meta = await import('../src/utils/meta.ts');
const { SERVER_SCENES } = await import('../api/_lib/scenes.ts');

const OUT = 'eval-out';
mkdirSync(OUT, { recursive: true });
const CALLS = path.join(OUT, '_calls-fix-ending.json');
const args = Object.fromEntries(process.argv.slice(3).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const mode = process.argv[2];
let calls = existsSync(CALLS) ? JSON.parse(readFileSync(CALLS, 'utf8')).count : 0;
const cap = calls + Number(args.max ?? 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function invoke(body) {
  const chunks = [];
  const res = { statusCode: 200, payload: null, status(c) { this.statusCode = c; return this; }, json(b) { this.payload = b; return this; }, setHeader() {}, write(s) { chunks.push(s); }, end() { return this; } };
  await handler({ method: 'POST', body }, res);
  if (res.payload) return { status: res.statusCode, error: res.payload.error, text: '' };
  let text = '';
  for (const p of chunks.join('').split('\n\n')) { const t = p.trim(); if (!t.startsWith('data: ')) continue; const e = JSON.parse(t.slice(6)); if (e.type === 'delta') text += e.text; }
  return { status: 200, text };
}
export async function api(body) {
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

/** 보고된 마무리 차례까지의 대화 (거래처 미팅 연기 요청 · 초급) */
export const CLOSING = [
  ['assistant', '네, 한빛상사 최민수입니다.'],
  ['user', '안녕하세요. 저는 미래전자 직원이에요.'],
  ['assistant', '네, 안녕하세요. 무슨 일이세요?'],
  ['user', '죄송해요. 내일 미팅을 다음 주로 미루고 싶어요.'],
  ['assistant', '아, 그래요? 무슨 일이 있어요?'],
  ['user', '회사에 일이 생겼어요.'],
  ['assistant', '그럼 언제가 좋아요?'],
  ['user', '다음 주 목요일 오전 10시 괜찮으세요?'],
  ['assistant', '네, 괜찮아요. 목요일 오전 10시에 봬요.'],
  ['user', '감사합니다. 목요일에 뵙겠습니다.'],
  ['assistant', '네, 목요일에 뵈어요. 감사합니다.'],
  ['user', '네, 감사합니다. 목요일에 뵙겠습니다.'],
  ['assistant', '네, 그럼 목요일에 뵙겠습니다. 감사합니다.'],
].map(([role, content]) => ({ role, content }));

/** 화면(RoleplaySupportPanel)과 같은 순서로 starter 결과 분류 */
export function classifyStarter(r, history, coreVocab) {
  if (r.status !== 200) return { kind: 'http' };
  const parsed = meta.extractSupport(r.text, 'starter');
  if (!parsed.ok) return { kind: `구조: ${parsed.kind}`, detail: parsed.error };
  if (!meta.replyToMatches(parsed.data.replyTo, history[history.length - 1].content)) return { kind: '구조: replyTo', detail: parsed.data.replyTo };
  if (meta.internalMarkerField(parsed.data)) return { kind: '구조: 내부 표시' };
  const issues = meta.supportDifficultyIssues(parsed.data, '초급', history.filter((m) => m.role === 'user').map((m) => m.content), coreVocab);
  return { kind: issues.length ? '난이도 위반(완화 표시)' : '통과', detail: issues, intent: parsed.data.intent, frame: parsed.data.frame.template, choices: parsed.data.choices.options.map((o) => `${o.verdict[0]}:${o.text}`) };
}

if (mode === 'repro') {
  try {
    const r = await api({ mode: 'roleplay_support', sceneId: 'client-postpone', level: '초급', supportType: 'starter', messages: CLOSING });
    writeFileSync(path.join(OUT, 'END-repro-starter.txt'), r.text);
    console.log(JSON.stringify(classifyStarter(r, CLOSING, SERVER_SCENES['client-postpone'].coreVocab), null, 1));
  } catch (e) { console.warn('중단:', e.message); }
  console.log(`이 작업 API 누적: ${calls}`);
}
