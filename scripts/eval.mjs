// 실제 응답 표본 검증 스크립트 (단계 3)
// 실행: node --import ./scripts/ts-register.mjs scripts/eval.mjs [--groups=A,B,C,D,E] [--ids=부분일치,…] [--dry]
// - /api/chat 핸들러(api/chat.ts)를 그대로 불러 실제 응답을 만들고, 원문을 eval-out/에 저장합니다.
// - 키는 기존과 같이 .env.local의 OPENAI_API_KEY를 씁니다(키 처리 방식은 바꾸지 않음).
// - 호출 사이 3초 간격, 전체 80회 한도(eval-out/_calls.json에 누적), 429는 60초 뒤 1회만 재시도.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const { default: handler } = await import('../api/chat.ts');
const meta = await import('../src/utils/meta.ts');
const { FORBIDDEN_WORDS, LEVEL_SPECS, VOCAB } = await import('../api/_lib/level-rules.ts');
const { SERVER_SCENES } = await import('../api/_lib/scenes.ts');
const { buildHistoryBlock, mergeHistory, EMPTY_HISTORY, extractIntroItems } = await import('../src/utils/expressionHistory.ts');
const { buildUsageBlock, emptyUsage } = await import('../src/utils/supportUsage.ts');

const OUT = 'eval-out';
mkdirSync(OUT, { recursive: true });
const CALLS_FILE = path.join(OUT, '_calls.json');
const RESULTS_FILE = path.join(OUT, 'results.json');
const LIMIT = 80;

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const groups = String(args.groups ?? 'A,B,C,D,E').split(',');
const idFilter = args.ids ? String(args.ids).split(',') : null;
const DRY = !!args.dry;

let calls = existsSync(CALLS_FILE) ? JSON.parse(readFileSync(CALLS_FILE, 'utf8')).count : 0;
const results = existsSync(RESULTS_FILE) ? JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) : {};
let stopped = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class BudgetError extends Error {}

/** 핸들러를 직접 호출하고 SSE 본문을 이어 붙여 돌려줌 */
async function invoke(body) {
  const chunks = [];
  const res = {
    statusCode: 200, headersSent: false, payload: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.payload = b; return this; },
    setHeader() { this.headersSent = true; },
    write(s) { chunks.push(s); },
    end() { return this; },
  };
  await handler({ method: 'POST', body }, res);
  if (res.payload) return { status: res.statusCode, error: res.payload.error };
  let text = '';
  let err = null;
  for (const part of chunks.join('').split('\n\n')) {
    const t = part.trim();
    if (!t.startsWith('data: ')) continue;
    const ev = JSON.parse(t.slice(6));
    if (ev.type === 'delta') text += ev.text;
    if (ev.type === 'error') err = ev.error;
  }
  return { status: err ? 500 : 200, text, error: err };
}

async function api(body) {
  if (stopped) throw new BudgetError('중단됨');
  if (calls >= LIMIT) { stopped = true; throw new BudgetError('API 호출 한도 80회 도달'); }
  if (DRY) return `[dry] ${body.mode}`;
  await sleep(3000);
  calls++;
  writeFileSync(CALLS_FILE, JSON.stringify({ count: calls }));
  let r = await invoke(body);
  if (r.status === 429) {
    console.warn('429 → 60초 대기 후 1회 재시도');
    await sleep(60000);
    if (calls >= LIMIT) { stopped = true; throw new BudgetError('API 호출 한도 80회 도달'); }
    calls++;
    writeFileSync(CALLS_FILE, JSON.stringify({ count: calls }));
    r = await invoke(body);
    if (r.status === 429) { stopped = true; throw new BudgetError('429 두 번 연속 → 실제 응답 검증 중단'); }
  }
  if (r.status !== 200) throw new Error(`HTTP ${r.status}: ${r.error}`);
  return r.text;
}

// ---------------- 자동 검사 도구 ----------------
const INTERNAL = /\[(?:Y\d+-\d+[^\]]*|보충[^\]]*|격식|난이도:[^\]]*|이미 소개한 문형|이미 쓴 대표 문장|도움 사용 기록|서버 안내)\]/;
const PLACEHOLDER = /\{\{\s*\d+\s*\}\}/;
const lineAfter = (text, label) => text.split('\n').map((l) => l.trim()).filter((l) => l.replace(/^[-·*\s]+/, '').startsWith(label)).map((l) => l.replace(/^[-·*\s]+/, '').slice(label.length).replace(/^\s*[:：]\s*/, '').trim());

function commonIssues(display, { level, allowForbidden = [] } = {}) {
  const issues = [];
  if (INTERNAL.test(display)) issues.push(`내부 표시 노출: ${display.match(INTERNAL)[0]}`);
  if (PLACEHOLDER.test(display)) issues.push('{{n}} 노출');
  for (const w of FORBIDDEN_WORDS) if (display.includes(w) && !allowForbidden.includes(w)) issues.push(`금지 어휘: ${w}`);
  if (level === '초급') {
    const higher = [...VOCAB.중급, ...VOCAB.고급].filter((w) => !w.endsWith('다') && display.includes(w));
    if (higher.length) issues.push(`(경고) 초급 문장에 위 단계 어휘 후보: ${higher.join(', ')}`);
  }
  return issues;
}
const maxE = (level) => LEVEL_SPECS[level].maxEojeol;
function lengthIssues(sentences, level, label) {
  const out = [];
  for (const s of sentences) {
    for (const part of meta.splitSentences(s.replace(/____/g, '빈칸'))) {
      const n = meta.countEojeol(part);
      if (n > maxE(level)) out.push(`${label} 어절 초과(${n}>${maxE(level)}): "${part}"`);
    }
  }
  return out;
}

function record(id, group, raw, issues, extra = {}) {
  const hard = issues.filter((i) => !i.startsWith('(경고)'));
  results[id] = { id, group, auto: hard.length ? 'fail' : 'pass', issues, chars: raw.length, at: new Date().toISOString(), ...extra };
  writeFileSync(path.join(OUT, `${id}.txt`), raw);
  writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`${hard.length ? '✖' : '✔'} ${id}${issues.length ? '  — ' + issues.join(' | ') : ''}`);
}
const want = (id) => !idFilter || idFilter.some((f) => id.includes(f));
/** 다시 검증할 때: 요청하지 않은 앞 단계 응답은 저장된 원문을 다시 씀 (API 호출 절약) */
const saved = (id) => (existsSync(path.join(OUT, `${id}.txt`)) ? readFileSync(path.join(OUT, `${id}.txt`), 'utf8') : null);
const exact = (id) => !!idFilter && idFilter.includes(id);

// ---------------- A. 표현 연습 ----------------
const startMsg = (topic, level) => ({ role: 'user', content: `주제: ${topic}\n난이도: ${level}\n위 조건에 맞는 직장 한국어 표현 연습을 시작해줘.` });

function checkIntro(display, level, prevHistory) {
  const issues = [];
  const title = display.match(/1단계:\s*표현 소개\s*\(세트\s*(\d+)\s*·\s*([^)]+)\)/);
  if (!title) issues.push('세트 제목 형식 아님');
  const items = display.split('\n').filter((l) => /^\s*\d+\.\s+/.test(l)).map((l) => l.replace(/^\s*\d+\.\s+/, '').replace(/\*\*/g, '').replace(/\s*\(복습\)\s*$/, '').trim());
  if (items.length !== 3) issues.push(`표현 개수 ${items.length}개`);
  const patterns = lineAfter(display, '문형');
  const more = lineAfter(display, '더 보기');
  if (patterns.length !== 3) issues.push(`"문형" 줄 ${patterns.length}개`);
  if (more.length !== 3) issues.push(`"더 보기" 줄 ${more.length}개`);
  if (!/퀴즈 시작/.test(display) || !/다른 표현/.test(display)) issues.push('마지막 안내문 없음');
  if (level === '초급') {
    const cautions = lineAfter(display, '주의');
    if (cautions.length && !patterns.some((p) => /ㅂ시다/.test(p))) issues.push('초급인데 "주의" 줄');
    if (!/^\s{3,}[A-Za-z]/m.test(display)) issues.push('초급 영어 병기 줄 없음');
  } else if (/^\s{3,}[A-Za-z][a-z]+ [a-z]+/m.test(display.split('"퀴즈 시작"')[0]) && level !== '초급') {
    issues.push('(경고) 중·고급인데 영어 병기 줄 후보');
  }
  issues.push(...lengthIssues(items, level, '대표 문장'), ...lengthIssues(more, level, '더 보기'));
  issues.push(...commonIssues(display, { level }));
  if (prevHistory) {
    const norm = (s) => meta.normalizeUtterance(s);
    const dupP = extractIntroItems(display).patterns.filter((p) => prevHistory.patterns.map(norm).includes(norm(p)));
    if (dupP.length && !/\(복습\)/.test(display)) issues.push(`이전 세트와 문형 중복: ${dupP.join(', ')}`);
    const dupS = items.filter((s) => prevHistory.sentences.map(norm).includes(norm(s)));
    if (dupS.length) issues.push(`이전 세트와 대표 문장 중복: ${dupS.join(' / ')}`);
  }
  return { issues, title: title ? `세트 ${title[1]} · ${title[2]}` : null };
}

function checkQuiz(display, level) {
  const issues = [];
  if (!/복습 퀴즈/.test(display)) issues.push('"복습 퀴즈" 제목 없음');
  const blanks = (display.match(/_{3,}/g) || []).length;
  if (blanks !== 1) issues.push(`빈칸 ${blanks}개`);
  const qLine = display.split('\n').find((l) => /_{3,}/.test(l)) || '';
  issues.push(...lengthIssues([qLine.replace(/_{3,}/g, '____')], level, '퀴즈 문장'));
  const hint = lineAfter(display, '힌트')[0] || '';
  if (!hint) issues.push('힌트 없음');
  if (level === '초급' && hint && /[가-힣]/.test(hint)) issues.push('초급 힌트에 한글');
  if (level !== '초급' && hint && !/[가-힣]/.test(hint)) issues.push('중·고급 힌트가 한국어가 아님');
  if (meta.countEojeol(hint) > 10) issues.push('힌트 10어절 초과');
  issues.push(...commonIssues(display, { level }));
  return issues;
}

async function groupA() {
  const topics = ['보고', '이메일', '회의'];
  const levels = ['초급', '중급', '고급'];
  const intros = {};
  for (const topic of topics) for (const level of levels) {
    const id = `A-intro-${topic}-${level}`;
    const msgs = [startMsg(topic, level)];
    if (!want(id) && !(topic === '보고' && level === '초급' && want('A-more')) && !want(`A-quiz-${level}`)) continue;
    const prev = results[id] && existsSync(path.join(OUT, `${id}.txt`)) && !want(id) ? readFileSync(path.join(OUT, `${id}.txt`), 'utf8') : null;
    const raw = prev ?? await api({ mode: 'expression', messages: msgs });
    const display = meta.cleanDisplayContent(meta.keepLastIntroSet(meta.collapseRepeatedReply(raw)));
    intros[`${topic}-${level}`] = display;
    if (!prev) { const c = checkIntro(display, level, null); record(id, 'A', raw, c.issues, { title: c.title }); }
  }
  // 보고·초급 "다른 표현" 2회
  if (want('A-more')) {
    let history = mergeHistory(EMPTY_HISTORY, intros['보고-초급']);
    const msgs = [startMsg('보고', '초급'), { role: 'assistant', content: intros['보고-초급'] }];
    for (let k = 1; k <= 2; k++) {
      const id = `A-more-보고-초급-${k}`;
      msgs.push({ role: 'user', content: '다른 표현' + buildHistoryBlock(history) });
      const raw = await api({ mode: 'expression', messages: msgs });
      const display = meta.cleanDisplayContent(meta.keepLastIntroSet(meta.collapseRepeatedReply(raw)));
      const c = checkIntro(display, '초급', history);
      const expectSet = k + 1;
      if (c.title && !c.title.startsWith(`세트 ${expectSet}`)) c.issues.push(`세트 번호가 ${expectSet}이 아님`);
      record(id, 'A', raw, c.issues, { title: c.title });
      msgs.push({ role: 'assistant', content: display });
      history = mergeHistory(history, display);
    }
  }
  // 난이도별 퀴즈 1회 (초급=보고, 중급=이메일, 고급=회의)
  const quizTopic = { 초급: '보고', 중급: '이메일', 고급: '회의' };
  for (const level of levels) {
    const id = `A-quiz-${level}`;
    if (!want(id)) continue;
    const topic = quizTopic[level];
    const intro = intros[`${topic}-${level}`];
    const msgs = [startMsg(topic, level), { role: 'assistant', content: intro }, { role: 'user', content: '퀴즈 시작' + buildHistoryBlock(mergeHistory(EMPTY_HISTORY, intro)) }];
    const raw = await api({ mode: 'expression', messages: msgs });
    record(id, 'A', raw, checkQuiz(meta.cleanDisplayContent(raw), level));
  }
}

// ---------------- B. 표현 연습 채점 회귀 ----------------
const B_CASES = [
  {
    key: '고급', topic: '보고', level: '고급',
    intro: '1단계: 표현 소개 (세트 1 · 전자 회사)\n1. 오늘 회의 결과를 보고드리겠습니다.\n- 번역: I will report today\'s meeting results.\n- 사용 장면: 팀장님에게 공식적으로 보고를 시작할 때\n- 문형: 보고드리겠습니다\n  · 기능: 윗사람에게 보고를 시작한다고 정중하게 말합니다.\n  · 만들기: 보고하다 → 보고드리겠습니다 / 말하다 → 말씀드리겠습니다\n  · 더 보기: 지난주 판매 결과를 보고드리겠습니다.\n\n"퀴즈 시작" → 지금까지 배운 표현으로 퀴즈 풀기\n"다른 표현" → 같은 주제의 새 표현 3개 더 보기',
    quiz: '복습 퀴즈\nQ. 다음 빈칸에 들어갈 알맞은 표현을 입력해 보세요.\n팀장님, 어제 진행한 고객 설문 결과를 ____.\n힌트: 상사에게 공식적으로 알리기 시작할 때\n답을 입력해 보세요.',
    answers: [['말씀드리겠습니다', ['alternative']], ['말하겠습니다', ['partial']], ['여쭙겠습니다', ['incorrect']]],
  },
  {
    key: '초급', topic: '회의', level: '초급',
    intro: '1단계: 표현 소개 (세트 1 · 여행사)\n1. 팀장님, 지금 시작할까요?\n- 번역: Shall we start now?\n- 사용 장면: 팀장님에게 무엇을 할지 물을 때\n- 문형: V-을까요?\n  · 기능: 상대의 생각을 물어요.\n    Asks what the other person thinks.\n  · 만들기: 시작하다 → 시작할까요?\n  · 더 보기: 커피를 살까요?\n\n"퀴즈 시작" → 지금까지 배운 표현으로 퀴즈 풀기 (Take a quiz on what you\'ve learned)\n"다른 표현" → 같은 주제의 새 표현 3개 더 보기 (See 3 more expressions)',
    quiz: '복습 퀴즈 (Review Quiz)\nQ. 다음 빈칸에 들어갈 알맞은 표현을 입력해 보세요.\n   (Fill in the blank with the correct expression.)\n팀장님, 내일 다시 ____.\n힌트: Suggesting something politely to your manager.\n답을 입력해 보세요. (Type your answer.)',
    answers: [['이야기합시다', ['partial']], ['이야기할까요', ['correct', 'alternative']]],
  },
];
function checkGrading(display, level, expected) {
  const issues = [];
  const v = meta.verdictFromResultLine(display);
  if (!v) issues.push('"결과:" 줄 없음');
  else if (!expected.includes(v)) issues.push(`판정 ${v} (기대: ${expected.join('|')})`);
  for (const label of ['내 답', '목표 표현', '완성 예문', '판단 근거']) if (!display.includes(label)) issues.push(`"${label}" 줄 없음`);
  if (level === '초급' && !/My answer|Result|Correct|Partly|Incorrect|Not quite/i.test(display)) issues.push('초급 영어 병기 없음');
  issues.push(...commonIssues(display, { level }));
  return { issues, verdict: v };
}
async function groupB() {
  for (const c of B_CASES) for (const [answer, expected] of c.answers) {
    const id = `B-${c.key}-${answer}`;
    if (!want(id)) continue;
    const msgs = [startMsg(c.topic, c.level), { role: 'assistant', content: c.intro }, { role: 'user', content: '퀴즈 시작' }, { role: 'assistant', content: c.quiz }, { role: 'user', content: answer }];
    const raw = await api({ mode: 'expression', messages: msgs });
    const display = meta.cleanDisplayContent(raw);
    const g = checkGrading(display, c.level, expected);
    const notes = meta.extractNotes(raw);
    if (g.verdict && ['partial', 'incorrect'].includes(g.verdict) && notes.length !== 1) g.issues.push(`🟡/❌인데 NOTES ${notes.length}개`);
    if (g.verdict && ['correct', 'alternative'].includes(g.verdict) && notes.length) g.issues.push('✅인데 NOTES 있음');
    record(id, 'B', raw, g.issues, { verdict: g.verdict, expected });
  }
}

// ---------------- C. 복습 채점 회귀 ----------------
const C_CASES = [
  ['바쁘시겠지만 내일까지 보내 주실 수 있을까요?', 'alternative'],
  ['내일까지 보내 주십시오', 'partial'],
  ['내일까지 보내', 'incorrect'],
];
async function groupC() {
  for (const [answer, expected] of C_CASES) {
    const id = `C-${expected}`;
    if (!want(id)) continue;
    const content = `[복습 채점 요청]\n장면: 이메일 첨삭 / 상대: 거래처 담당자 / 원래 표현: 내일까지 보내 주세요 / 모범 표현: 번거로우시겠지만 내일까지 보내 주시면 감사하겠습니다 / 범주: 완곡 표현 / 학습자 답: ${answer}`;
    const raw = await api({ mode: 'review', messages: [{ role: 'user', content }] });
    const issues = [];
    const block = raw.match(/\[\[RESULT\]\]([\s\S]*?)\[\[\/RESULT\]\]/);
    if (!block) issues.push('[[RESULT]] 블록 없음');
    const r = meta.extractResult(raw);
    if (!r) issues.push('판정 읽기 실패');
    else if (r.verdict !== expected) issues.push(`판정 ${r.verdict} (기대: ${expected})`);
    const lineV = meta.verdictFromResultLine(raw);
    if (r && lineV && lineV !== r.verdict) issues.push(`결과 줄(${lineV})과 블록(${r.verdict}) 불일치`);
    const display = meta.cleanDisplayContent(raw);
    for (const label of ['결과', '내 답', '모범 표현', '판단 근거']) if (!display.includes(label)) issues.push(`"${label}" 줄 없음`);
    issues.push(...commonIssues(display, {}));
    record(id, 'C', raw, issues, { verdict: r?.verdict, expected });
  }
}

// ---------------- D. 롤플레이 ----------------
const FEEDBACK_TEXT = '[피드백 요청] 대화를 마치고 피드백을 주세요.';
const LEARNER = {
  'report-progress': {
    초급: ['행사 일은 70% 끝났어요.', '장소에 문제가 하나 있어요.'],
    중급: ['네, 행사 준비는 70% 정도 됐어요.', '그런데 장소 계약에 문제가 하나 있어요.'],
    고급: ['네, 현재 행사 준비는 약 70% 진행됐습니다.', '다만 장소 계약에 문제가 하나 있어 확인 중입니다.'],
  },
  'meeting-disagree': {
    초급: ['좋은 생각이에요. 하지만 돈이 많이 들어요.', '우리 손님은 나이가 많아요.'],
    중급: ['SNS 광고도 좋은 방법인 것 같아요. 그런데 예산이 좀 부족할 것 같아요.', '주 고객층이 40대라서 신문 광고도 같이 하면 좋겠어요.'],
    고급: ['SNS 광고도 좋은 방법이기는 하지만, 예산이 조금 걱정됩니다.', '주 고객층이 40~50대라서 오프라인 홍보도 함께 하면 좋겠습니다.'],
  },
};
const TURN_SENTENCES = { 초급: 2, 중급: 2, 고급: 3 };

function checkReply(display, level) {
  const issues = [];
  const body = display.replace(/\([^)]*\)/g, '').trim();
  const sentences = meta.splitSentences(body);
  if (sentences.length > TURN_SENTENCES[level]) issues.push(`상대역 ${sentences.length}문장(최대 ${TURN_SENTENCES[level]})`);
  issues.push(...lengthIssues(sentences, level, '상대역'));
  if (/\[\[NOTES\]\]|## 롤플레이 피드백/.test(display)) issues.push('대화 중 피드백 형식');
  issues.push(...commonIssues(display, { level }));
  return issues;
}
function supportSentences(d) {
  if (d.type === 'starter') return [d.frame.template.replace(/\{\{\d+\}\}/g, '빈칸'), ...d.choices.options.map((o) => o.text)];
  if (d.type === 'frame') return [d.template.replace(/\{\{\d+\}\}/g, '빈칸')];
  if (d.type === 'choices') return d.options.map((o) => o.text);
  if (d.type === 'model') return [d.text];
  return [];
}
function checkSupport(raw, type, level, target, learnerSaid = []) {
  const issues = [];
  const r = meta.extractSupport(raw, type);
  if (!r.ok) return { issues: [`${r.kind}: ${r.error}`], data: null };
  if (!meta.replyToMatches(r.data.replyTo, target)) issues.push(`replyTo 불일치: "${r.data.replyTo}"`);
  if (level === '초급') {
    const b = meta.beginnerSupportIssue(r.data);
    if (b) issues.push(`초급 범위: ${b}`);
    const ko = meta.koreanInEnglishFields(r.data);
    if (ko.length) issues.push(`(경고) 영어 칸 한글: ${ko.join(', ')}`);
    if (!r.data.intent_en) issues.push('초급 intent_en 비어 있음');
  } else {
    issues.push(...lengthIssues(supportSentences(r.data), level, '도움 문장'));
  }
  const rep = meta.repeatsLearner(r.data, learnerSaid);
  if (rep) issues.push(rep);
  const allText = JSON.stringify(r.data);
  for (const w of FORBIDDEN_WORDS) if (allText.includes(w)) issues.push(`금지 어휘: ${w}`);
  if (INTERNAL.test(allText)) issues.push('내부 표시 노출');
  return { issues, data: r.data };
}
function checkFeedback(raw, level, withUsage, usageBlock = '') {
  const issues = [];
  const display = meta.cleanDisplayContent(raw);
  if (!/직접 쓴 발화: 없음/.test(usageBlock) && /직접 쓴 발화가 없어서/.test(display)) issues.push('직접 쓴 발화가 있는데 "직접 쓴 발화가 없어서" 생략');
  for (const h of ['## 롤플레이 피드백', '### 잘한 점', '### 다시 생각해 볼 표현', '### 말하기 순서 점검', '### 다음에 써 볼 한 문장']) if (!display.includes(h)) issues.push(`"${h}" 없음`);
  if (withUsage && !display.includes('### 도움 사용')) issues.push('"### 도움 사용" 없음');
  if (!/\[\[NOTES\]\][\s\S]*?\[\[\/NOTES\]\]/.test(raw)) issues.push('[[NOTES]] 블록 없음');
  else if (!/\[\[NOTES\]\]\s*(?:```(?:json)?)?\s*\[\s*\]/.test(raw) && meta.extractNotes(raw).length === 0) issues.push('NOTES 파싱 실패');
  if (level === '초급') {
    const next = display.split('### 다음에 써 볼 한 문장')[1]?.split('\n').map((l) => l.replace(/^[-*\s]+/, '').trim()).find((l) => /[가-힣]/.test(l)) ?? '';
    if (next && meta.countEojeol(next.replace(/["“”]/g, '')) > 5) issues.push(`초급 "다음에 써 볼 한 문장" 5어절 초과: ${next}`);
    if (!/[A-Za-z]{3,} [A-Za-z]{2,}/.test(display.split('### 잘한 점')[1] ?? '')) issues.push('초급 영어 병기 없음');
  }
  issues.push(...commonIssues(display, { level }));
  return issues;
}

async function groupD() {
  for (const sceneId of ['report-progress', 'meeting-disagree']) for (const level of ['초급', '중급', '고급']) {
    const base = `D-${sceneId}-${level}`;
    if (idFilter && !idFilter.some((f) => f.startsWith(base) || base.includes(f))) continue;
    // --ids에 정확한 id를 주면 그 표본만 새로 만들고, 나머지 앞 단계는 저장된 원문을 씀
    const fresh = (id) => !idFilter || exact(id) || !saved(id);
    const scene = SERVER_SCENES[sceneId];
    const msgs = [{ role: 'assistant', content: level === '초급' ? scene.openingLineBeginner : scene.firstMessage }];
    const usage = emptyUsage();
    const support = async (type, turn) => {
      const target = msgs[msgs.length - 1].content;
      const id = `${base}-t${turn}-${type}`;
      if (type !== 'starter') usage.counts[type] += 1;
      else { usage.counts.frame += 1; usage.counts.choices += 1; }
      if (type === 'choices' || type === 'starter') usage.firstChoices.push('appropriate');
      if (!fresh(id)) return;
      const raw = await api({ mode: 'roleplay_support', sceneId, level, supportType: type, messages: msgs });
      const c = checkSupport(raw, type, level, target, msgs.filter((m) => m.role === 'user').map((m) => m.content));
      record(id, 'D', raw, c.issues, { target });
    };
    const say = async (text, turn) => {
      msgs.push({ role: 'user', content: text });
      const id = `${base}-r${turn}`;
      const raw = fresh(id) ? await api({ mode: 'roleplay', sceneId, level, messages: msgs }) : saved(id);
      const display = meta.cleanDisplayContent(raw);
      if (fresh(id)) record(id, 'D', raw, checkReply(display, level), { learner: text });
      msgs.push({ role: 'assistant', content: meta.stripMetaForHistory(raw) });
    };
    if (level === '초급') await support('starter', 1);
    await say(LEARNER[sceneId][level][0], 1);
    if (level === '초급') await support('starter', 2);
    else for (const t of ['hint', 'frame', 'choices', 'model']) await support(t, 2);
    await say(LEARNER[sceneId][level][1], 2);
    if (level === '초급') await support('starter', 3);
    const userTurns = msgs.filter((m) => m.role === 'user').length;
    const block = buildUsageBlock(usage, userTurns);
    msgs.push({ role: 'user', content: FEEDBACK_TEXT + block });
    if (!fresh(`${base}-feedback`)) continue;
    const raw = await api({ mode: 'roleplay', sceneId, level, messages: msgs });
    record(`${base}-feedback`, 'D', raw, checkFeedback(raw, level, !!block, block), { usage: block });
  }
}

// ---------------- E. 이메일 ----------------
const E_CASES = [
  { id: 'E-client-request', recipient: '거래처 담당자', purpose: '요청', subject: '견적서 요청', body: '안녕하세요.\n지난번에 말씀하신 견적서를 내일까지 보내 주세요.', expectCategory: true },
  { id: 'E-colleague-reschedule', recipient: '같은 팀 동료', purpose: '일정 변경·연기', subject: '회의 일정', body: '민수 씨, 내일 오후 회의를 금요일 오전으로 바꿔요. 시간 괜찮아요?', expectCategory: false },
];
async function groupE() {
  for (const c of E_CASES) {
    if (!want(c.id)) continue;
    const content = `[이메일 첨삭 요청]\n받는 사람: ${c.recipient}\n목적: ${c.purpose}\n상황 메모: (없음)\n제목: ${c.subject}\n본문:\n${c.body}`;
    const raw = await api({ mode: 'email', messages: [{ role: 'user', content }] });
    const display = meta.cleanDisplayContent(raw);
    const issues = [];
    for (const h of ['## 첨삭 결과', '### 한눈에 보기', '### 고칠 부분', '### 고친 예시']) if (!display.includes(h)) issues.push(`"${h}" 없음`);
    if (!/\[\[NOTES\]\][\s\S]*?\[\[\/NOTES\]\]/.test(raw)) issues.push('[[NOTES]] 블록 없음');
    const notes = meta.extractNotes(raw);
    if (c.expectCategory && !notes.some((n) => (n.category === '완곡 표현' || n.category === '높임법') && /보내/.test(n.original))) issues.push('"보내 주세요"에 대한 완곡 표현·높임법 지적 없음');
    issues.push(...commonIssues(display, {}));
    record(c.id, 'E', raw, issues, { notes: notes.length });
  }
}

const runners = { A: groupA, B: groupB, C: groupC, D: groupD, E: groupE };
try {
  for (const g of groups) {
    if (stopped) break;
    console.log(`\n=== ${g} ===`);
    await runners[g]();
  }
} catch (e) {
  if (e instanceof BudgetError) console.warn(`\n중단: ${e.message}`);
  else throw e;
} finally {
  console.log(`\nAPI 호출 누적: ${calls}/${LIMIT}`);
}
