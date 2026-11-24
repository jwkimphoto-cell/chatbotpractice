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

// ---------------- run: 대화를 끝까지 진행하며 종료 처리 확인 ----------------
if (mode === 'run') {
  const { decideEnding, isClosingUtterance, nearlySame } = await import('../src/utils/ending.ts');
  const SCENARIOS = [
    {
      id: 'client-postpone-초급', sceneId: 'client-postpone', level: '초급',
      learner: ['안녕하세요. 저는 미래전자 직원이에요.', '죄송해요. 내일 미팅을 다음 주로 미루고 싶어요.', '회사에 일이 생겼어요.', '다음 주 목요일 오전 10시 괜찮으세요?', '감사합니다. 목요일에 뵙겠습니다.', '네, 감사합니다. 목요일에 뵙겠습니다.'],
      resume: '그런데 하나 더 여쭤봐도 돼요?',
    },
    {
      id: 'report-progress-중급', sceneId: 'report-progress', level: '중급',
      learner: ['네, 행사 준비는 70% 정도 됐어요.', '그런데 장소 계약에 문제가 하나 있어요. 날짜가 겹쳤어요.', '다른 장소를 알아보고 있어요. 금요일까지 정할게요.', '네, 감사합니다. 금요일에 다시 말씀드릴게요.', '네, 감사합니다.'],
    },
  ];
  const only = args.only ? String(args.only).split(',') : null;
  const results = [];
  try {
    for (const sc of SCENARIOS) {
      if (only && !only.includes(sc.id)) continue;
      const scene = SERVER_SCENES[sc.sceneId];
      const msgs = [{ role: 'assistant', content: sc.level === '초급' ? scene.openingLineBeginner : scene.firstMessage }];
      const log = [];
      let ended = null;
      for (const text of sc.learner) {
        msgs.push({ role: 'user', content: text });
        const r = await api({ mode: 'roleplay', sceneId: sc.sceneId, level: sc.level, messages: msgs.map((m) => ({ role: m.role, content: meta.stripMetaForHistory(m.content) })) });
        msgs.push({ role: 'assistant', content: r.text });
        const assistantTurns = msgs.filter((m) => m.role === 'assistant');
        const repeatedPrev = assistantTurns.length >= 2 && nearlySame(assistantTurns.at(-1).content, assistantTurns.at(-2).content);
        ended = decideEnding(msgs, [r.text]);
        log.push({ learner: text, reply: r.text, END: meta.hasEndMarker(r.text), closing: isClosingUtterance(r.text), repeatsPrevReply: repeatedPrev, decision: ended });
        if (ended) break;
      }
      let resume = null;
      if (sc.resume && ended) {
        const from = msgs.length;
        msgs.push({ role: 'user', content: sc.resume });
        const r = await api({ mode: 'roleplay', sceneId: sc.sceneId, level: sc.level, resume: true, messages: msgs.map((m) => ({ role: m.role, content: meta.stripMetaForHistory(m.content) })) });
        msgs.push({ role: 'assistant', content: r.text });
        resume = { learner: sc.resume, reply: r.text, END: meta.hasEndMarker(r.text), repeatsClosing: isClosingUtterance(r.text), decisionAfterResume: decideEnding(msgs, [r.text], from) };
      }
      writeFileSync(path.join(OUT, `END-run-${sc.id}.json`), JSON.stringify({ log, resume }, null, 2));
      results.push({ id: sc.id, turns: log.length, endedBy: ended, log, resume });
    }
  } catch (e) { console.warn('중단:', e.message); }
  console.log(JSON.stringify(results, null, 1));
  console.log(`이 작업 API 누적: ${calls}`);
}

// ---------------- resume2: 저장된 대화(종료까지)에 학습자의 중립적인 말로 이어 가기 ----------------
if (mode === 'resume2') {
  const { decideEnding, isClosingUtterance } = await import('../src/utils/ending.ts');
  try {
    const saved = JSON.parse(readFileSync(path.join(OUT, 'END-run-client-postpone-초급.json'), 'utf8'));
    const msgs = [{ role: 'assistant', content: SERVER_SCENES['client-postpone'].openingLineBeginner }];
    for (const t of saved.log) msgs.push({ role: 'user', content: t.learner }, { role: 'assistant', content: t.reply });
    const from = msgs.length;
    const learner = String(args.text ?? '네, 알겠습니다.');
    msgs.push({ role: 'user', content: learner });
    const r = await api({ mode: 'roleplay', sceneId: 'client-postpone', level: '초급', resume: true, messages: msgs.map((m) => ({ role: m.role, content: meta.stripMetaForHistory(m.content) })) });
    writeFileSync(path.join(OUT, 'END-resume2.txt'), r.text);
    console.log(JSON.stringify({ learner, reply: r.text, END: meta.hasEndMarker(r.text), repeatsClosing: isClosingUtterance(r.text), decisionAfterResume: decideEnding([...msgs, { role: 'assistant', content: r.text }], [r.text], from), beginnerIssues: meta.beginnerReplyIssues(r.text, [], SERVER_SCENES['client-postpone'].coreVocab) }, null, 1));
  } catch (e) { console.warn('중단:', e.message); }
  console.log(`이 작업 API 누적: ${calls}`);
}
