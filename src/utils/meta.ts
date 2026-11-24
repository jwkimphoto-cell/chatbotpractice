export type NoteCategory = '높임법' | '완곡 표현' | '보고 순서' | '어휘·문법';

export interface ParsedNoteItem {
  scene: string;
  counterpart: string;
  original: string;
  corrected: string;
  category: NoteCategory;
  reason: string;
}

/** 복습 채점 4단계 판정 */
export type ReviewVerdict = 'correct' | 'alternative' | 'partial' | 'incorrect';

export interface ParsedResult {
  verdict: ReviewVerdict;
  /** verdict가 correct·alternative이면 true (기존 코드 호환용) */
  correct: boolean;
}

const ALLOWED_VERDICTS: ReviewVerdict[] = ['correct', 'alternative', 'partial', 'incorrect'];

export function isPassingVerdict(verdict: ReviewVerdict): boolean {
  return verdict === 'correct' || verdict === 'alternative';
}

const ALLOWED_CATEGORIES: NoteCategory[] = ['높임법', '완곡 표현', '보고 순서', '어휘·문법'];

/**
 * 표현 연습 문형 목록의 출처 표시([Y1-10], [Y2-9·추정], [보충], [보충·고정 표현], [격식])를 지웁니다.
 * 프롬프트로 금지하지만 "문형: 보고드리겠습니다 [격식]"처럼 새어 나오는 경우가 있어 화면 표시 전에 한 번 더 거릅니다.
 * 이메일 첨삭의 [담당자명]·[날짜] 같은 자리표시는 이 형태가 아니므로 남습니다. 표현 연습 화면에서만 사용합니다.
 */
const SOURCE_TAG_REGEX = /[ \t]*\[(?:Y\d+-\d+(?:·[^\]\n]*)?|보충(?:·[^\]\n]*)?|격식)\]/g;

export function stripSourceTags(text: string): string {
  if (!text) return '';
  return text.replace(SOURCE_TAG_REGEX, '');
}

/**
 * 응답 전체가 같은 내용으로 두 번 이어 붙은 경우(모델이 초안과 최종본을 둘 다 낸 경우) 한 번만 남깁니다.
 * 앞뒤 절반이 공백만 빼고 완전히 같을 때만 줄이며, 짧은 응답(40자 미만)은 건드리지 않습니다.
 */
export function collapseRepeatedReply(text: string): string {
  if (!text) return '';
  const t = text.trim();
  if (t.length < 80) return text;
  const mid = Math.floor(t.length / 2);
  for (let i = mid - 8; i <= mid + 8; i++) {
    if (i <= 0 || i >= t.length) continue;
    const a = t.slice(0, i).trim();
    const b = t.slice(i).trim();
    if (a.length >= 40 && a === b) return a;
  }
  return text;
}

/**
 * 표현 소개 응답에 세트 제목("1단계: 표현 소개 …")이 두 번 이상 나오면(초안을 낸 뒤 고친 판을 다시 낸 경우)
 * 마지막 판만 남깁니다. 세트 제목 앞에 "(지난 퀴즈 정답: …)" 같은 머리말이 있으면 그 부분은 유지합니다.
 */
export function keepLastIntroSet(text: string): string {
  if (!text) return '';
  // 두 번째 판이 줄바꿈 없이 앞 줄 끝에 붙어 오는 경우가 있어 줄 처음이 아니어도 찾음 ("(세트"까지 맞아야 인정)
  const re = /(?:\*\*)?1단계:\s*표현 소개\s*\(세트/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) starts.push(m.index);
  if (starts.length < 2) return text;
  const head = text.slice(0, starts[0]);
  return head + text.slice(starts[starts.length - 1]);
}

/** 메시지 앞의 "[난이도: …]" 표시 제거 (이전 버전이 롤플레이 첫 발화에 붙이던 내부 표시) */
export function stripLevelTag(text: string): string {
  return (text || '').replace(/^\s*\[난이도:[^\]]*\]\s*/, '');
}

/**
 * 내부 표시 제거 (모든 탭 화면 표시용):
 * - 맨 앞 "[난이도: …]" 표시 (이전 버전 잔재)
 * - 문형 목록 출처 표시([Y1-10], [Y2-9·추정], [보충], [격식])
 * - 앱이 전송용 메시지에만 붙이는 블록([이미 소개한 문형]·[이미 쓴 대표 문장]·[도움 사용 기록])과 [서버 안내] 블록이
 *   응답에 새어 나온 경우 그 블록(제목 줄 ~ 빈 줄 전까지)
 * 이메일 첨삭의 [날짜]·[담당자명] 같은 자리표시는 이 형태가 아니므로 남습니다.
 */
const INTERNAL_BLOCK_REGEX = /^[ \t]*\[(?:이미 소개한 문형|이미 쓴 대표 문장|도움 사용 기록|서버 안내|이번 세트 문형[^\]\n]*)\][^\n]*(?:\n(?![ \t]*\n)[^\n]*)*\n?/gm;
export function stripInternalMarkers(text: string): string {
  if (!text) return '';
  return stripSourceTags(stripLevelTag(text)).replace(END_MARKER_REGEX, '').replace(INTERNAL_BLOCK_REGEX, '').replace(/\n{3,}/g, '\n\n');
}

/**
 * 롤플레이 상대역이 대화가 끝났다고 알리는 표시 [[END]] (응답 끝에 붙음).
 * 화면에는 보이지 않고(stripInternalMarkers), 다음 요청의 대화 기록에서도 지움(stripMetaForHistory)
 */
const END_MARKER_REGEX = /[ \t]*\[\[END\]\][ \t]*/g;
export function hasEndMarker(text: string): boolean {
  return /\[\[END\]\]/.test(text || '');
}

/**
 * 화면 표시용 텍스트 정제:
 * 0) 내부 표시 제거 (stripInternalMarkers)
 * 1) [[NOTES]] 또는 [[RESULT]] 시작점부터 뒤쪽 전체를 숨김
 * 2) 스트리밍 중 마커 앞부분(예: "[[", "[[N", "[[NOTES", "[[R" 등)으로 끝나는 꼬리도 숨김
 */
export function cleanDisplayContent(text: string): string {
  if (!text) return '';
  text = stripInternalMarkers(text);

  // 1. 이미 완성되었거나 시작된 마커 위치 찾기
  const notesIndex = text.indexOf('[[NOTES]]');
  if (notesIndex !== -1) {
    return text.slice(0, notesIndex).trimEnd();
  }

  const resultIndex = text.indexOf('[[RESULT]]');
  if (resultIndex !== -1) {
    return text.slice(0, resultIndex).trimEnd();
  }

  // 2. 스트리밍 중 마커의 일부(접두사)가 문자열 끝에 붙어 있는 경우 숨김
  // 가능한 접두사 패턴: [[N, [[NO, [[NOT, [[NOTE, [[NOTES, [[NOTES], [[R, [[RE, [[RES, [[RESU, [[RESUL, [[RESULT, [[RESULT], [[
  const partialMarkerRegex = /\[(?:\[(?:N(?:O(?:T(?:E(?:S(?:\])?)?)?)?)?|R(?:E(?:S(?:U(?:L(?:T(?:\])?)?)?)?)?)?|E(?:N(?:D(?:\])?)?)?)?)?$/;
  return text.replace(partialMarkerRegex, '').trimEnd();
}

/**
 * 대화 기록을 서버로 다시 보낼 때 메타 블록([[NOTES]]...[[/NOTES]], [[RESULT]]...[[/RESULT]])을 제거
 */
export function stripMetaForHistory(text: string): string {
  if (!text) return '';
  return stripLevelTag(text)
    .replace(END_MARKER_REGEX, '')
    .replace(/\[\[NOTES\]\][\s\S]*?\[\[\/NOTES\]\]/g, '')
    .replace(/\[\[RESULT\]\][\s\S]*?\[\[\/RESULT\]\]/g, '')
    // 닫는 마커 없이 잘린 메타 블록은 시작 마커부터 끝까지 제거
    .replace(/\[\[(?:NOTES|RESULT)\]\][\s\S]*$/, '')
    .trim();
}

/** corrected가 original과 같거나 original의 어절 일부를 순서대로 빼기만 한 것인지 */
export function isWordDeletionOnly(original: string, corrected: string): boolean {
  const words = (t: string) => t.replace(/[\p{P}\p{S}]/gu, ' ').split(/\s+/).filter(Boolean);
  const o = words(original);
  const c = words(corrected);
  if (c.length > o.length) return false;
  let i = 0;
  for (const w of o) if (i < c.length && w === c[i]) i++;
  return i === c.length;
}

/** 메타 블록 안의 코드 펜스(```json … ```) 제거 */
function stripCodeFence(text: string): string {
  return text.replace(/```(?:json)?/gi, '').trim();
}

/**
 * 응답 텍스트에서 [[NOTES]] ... [[/NOTES]] 블록을 추출하여 유효성 검증된 Note 목록을 반환
 * 파싱 실패 시 조용히 빈 배열 반환
 */
export function extractNotes(text: string): ParsedNoteItem[] {
  if (!text) return [];

  const match = text.match(/\[\[NOTES\]\]([\s\S]*?)\[\[\/NOTES\]\]/);
  if (!match || !match[1]) return [];

  try {
    // 금지했지만 코드 펜스(```json)를 붙여 오는 경우가 있어 지우고 읽음
    const rawJson = stripCodeFence(match[1]);
    if (!rawJson || rawJson === '[]') return [];

    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) return [];

    const validated: ParsedNoteItem[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item.scene === 'string' &&
        typeof item.counterpart === 'string' &&
        typeof item.original === 'string' &&
        typeof item.corrected === 'string' &&
        typeof item.reason === 'string' &&
        ALLOWED_CATEGORIES.includes(item.category) &&
        // 고친 표현이 원래 표현과 같거나(문장부호·공백만 다름) 원래 표현에서 낱말을 빼기만 했으면 버림
        // (예: "우리 손님은 나이가 많아요" → "손님은 나이가 많아요" — 고칠 문제가 없는 문장을 지적한 경우)
        !isWordDeletionOnly(item.original, item.corrected)
      ) {
        validated.push({
          scene: item.scene.trim(),
          counterpart: item.counterpart.trim(),
          original: item.original.trim(),
          corrected: item.corrected.trim(),
          category: item.category,
          reason: item.reason.trim(),
        });
      }
    }
    return validated;
  } catch {
    return [];
  }
}

/**
 * "결과:" 줄에서 판정을 읽습니다. ([[RESULT]] 블록이 빠졌을 때의 대신 읽기용)
 * 공백을 지운 뒤 비교하며, 짧은 문구가 긴 문구에 포함되므로 반드시 긴 문구부터 확인합니다.
 *   "✅ 정답(다른 적절한 표현)" → alternative  (← "✅ 정답"보다 먼저 확인)
 *   "🟡 부분 정답"              → partial      (← "정답"을 포함하므로 correct보다 먼저 확인)
 *   "❌ 오답"                   → incorrect
 *   "✅ 정답"                   → correct
 */
export function verdictFromResultLine(text: string): ReviewVerdict | null {
  if (!text) return null;
  const line = text.match(/^\s*결과\s*[:：](.*)$/m);
  if (!line) return null;
  const v = line[1].replace(/\s+/g, '');
  if (!v) return null;
  if (v.includes('정답(다른적절한표현)')) return 'alternative';
  if (v.includes('🟡') || v.includes('부분정답')) return 'partial';
  if (v.includes('❌') || v.includes('오답') || v.includes('아쉬워요')) return 'incorrect';
  if (v.includes('✅') || v.includes('정답')) return 'correct';
  return null;
}

function parseResultBlock(text: string): ParsedResult | null {
  const match = text.match(/\[\[RESULT\]\]([\s\S]*?)\[\[\/RESULT\]\]/);
  if (!match || !match[1]) return null;

  try {
    const parsed = JSON.parse(stripCodeFence(match[1]));
    if (!parsed || typeof parsed !== 'object') return null;

    // verdict가 있으면 verdict 기준, 없으면 기존 correct 값으로 판단 (하위 호환)
    if (ALLOWED_VERDICTS.includes(parsed.verdict)) {
      const verdict = parsed.verdict as ReviewVerdict;
      return { verdict, correct: isPassingVerdict(verdict) };
    }
    if (typeof parsed.correct === 'boolean') {
      return { verdict: parsed.correct ? 'correct' : 'incorrect', correct: parsed.correct };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 응답 텍스트에서 채점 결과를 반환합니다.
 * 1) [[RESULT]] 블록을 우선 사용
 * 2) 블록이 없거나 잘못됐으면 "결과:" 줄로 대신 읽고 console.warn으로 기록 (누락 빈도 확인용)
 * 3) 둘 다 실패하면 null → 화면에서 자기 채점으로 전환
 */
export function extractResult(text: string): ParsedResult | null {
  if (!text) return null;

  const fromBlock = parseResultBlock(text);
  if (fromBlock) return fromBlock;

  const verdict = verdictFromResultLine(text);
  if (verdict) {
    console.warn(
      `[extractResult] [[RESULT]] 블록이 없거나 잘못되어 "결과:" 줄로 판정을 대신 읽었습니다 (verdict: ${verdict}).`,
    );
    return { verdict, correct: isPassingVerdict(verdict) };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 롤플레이 도움 사다리 응답 파싱 ([[SUPPORT]]{ JSON }[[/SUPPORT]])        */
/* ------------------------------------------------------------------ */

export type SupportKind = 'hint' | 'frame' | 'choices' | 'model' | 'starter';
export type SupportVerdict = 'appropriate' | 'partial' | 'inappropriate';

export interface SupportHint {
  type: 'hint';
  steps: string[];
  steps_en: string[];
}
export interface SupportBlank {
  id: number;
  hint: string;
  hint_en: string;
}
export interface SupportFrameBody {
  template: string;
  blanks: SupportBlank[];
}
export interface SupportChoiceOption {
  id: string;
  text: string;
  verdict: SupportVerdict;
  reason: string;
  reason_en: string;
}
export interface SupportChoicesBody {
  options: SupportChoiceOption[];
}
export interface SupportModel {
  type: 'model';
  text: string;
  text_en: string;
  tip: string;
  tip_en: string;
}
/** 모든 도움 응답에 공통으로 붙는 필드: 어느 상대역 발화에 대한 도움인지(replyTo), 그 발화가 요구하는 것(intent) */
export interface SupportMeta {
  replyTo: string;
  intent: string;
  intent_en: string;
}
export type SupportData = SupportMeta &
  (
    | SupportHint
    | ({ type: 'frame' } & SupportFrameBody)
    | ({ type: 'choices' } & SupportChoicesBody)
    | SupportModel
    | { type: 'starter'; frame: SupportFrameBody; choices: SupportChoicesBody }
  );

/** 실패 분류: 잘림 / JSON 파싱 / 구조 검증 / 빈칸 기호가 frame.template 밖에 있음 */
export type SupportFailKind = 'truncated' | 'parse' | 'schema' | 'placeholder';
export type SupportParseResult = { ok: true; data: SupportData } | { ok: false; error: string; kind: SupportFailKind };
type InnerResult = { ok: true; data: SupportData } | { ok: false; error: string };

const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 발화 비교용 정규화: 공백·문장부호·기호를 모두 지움 */
export function normalizeUtterance(text: string): string {
  return stripLevelTag(text || '').replace(/[\s\p{P}\p{S}]/gu, '');
}

/**
 * 도움 응답의 replyTo가 실제 마지막 상대역 발화와 같은지.
 * 공백·문장부호를 지우고 비교하며, 한쪽이 다른 쪽을 포함하면 일치로 봄 (모델이 앞뒤를 줄여 복사하는 경우 허용)
 */
export function replyToMatches(replyTo: string, actual: string): boolean {
  const a = normalizeUtterance(replyTo);
  const b = normalizeUtterance(actual);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  // 모델이 상대역 발화 중 한 문장(대개 마지막 질문)만 복사한 경우
  return (actual || '').split(/(?<=[.?!。？！])\s*/).some((sentence) => {
    const n = normalizeUtterance(sentence);
    return n.length > 0 && n === a;
  });
}

/*
 * 어절 세기 (docs/level-guide.md 1-2와 같은 기준):
 * - 괄호 안 글은 빼고 셈
 * - 시각 표현(두 시, 오전 열 시, 세 시 반, 3시 30분)은 띄어 써도 한 어절
 * - '-(으)ㄹ 수(도) 있다', '-고 있다', '-아/어 주다'(보내 주세요)는 앞 동사와 함께, 'N 중이다'는 앞 명사와 함께 한 어절
 */
const NUM_WORD = '(?:열(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉)?|한|두|세|네|다섯|여섯|일곱|여덟|아홉|몇|\\d+)';
const TIME_EXPR = new RegExp(
  `(?:(?:오전|오후|새벽|아침|저녁|밤)\\s+)?${NUM_WORD}\\s*시(?:\\s+(?:반|${NUM_WORD}\\s*분|(?:십|이십|삼십|사십|오십)\\s*분))?`,
  'g',
);
const AEO_VOWELS = new Set([0, 1, 4, 5, 6, 9, 10, 14, 15]); // ㅏ ㅐ ㅓ ㅔ ㅕ ㅘ ㅙ ㅝ ㅞ
const NOUNS_LIKE_AEO = new Set(['전화', '사과', '회사', '의자', '차']);
/** '-아/어' 연결형처럼 끝나는 말인지 (보내, 확인해, 기다려, 읽어 → true / 전화, 자료, 좀, 자료를 → false) */
function isAeoForm(word: string): boolean {
  if (NOUNS_LIKE_AEO.has(word)) return false;
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return false;
  return code % 28 === 0 && AEO_VOWELS.has(Math.floor(code / 28) % 21);
}

export function countEojeol(sentence: string): number {
  const s = sentence
    .replace(/\([^)]*\)/g, '')
    .trim()
    .replace(TIME_EXPR, (m) => m.replace(/\s+/g, ''))
    .replace(/(\S+)\s+수도?\s+(있\S*)/g, '$1수$2')
    .replace(/(\S+고)\s+(있\S*)/g, '$1$2')
    .replace(/(\S+)\s+(중(?:입|이|인)\S*)/g, '$1$2')
    // '-아/어 주다': 앞 말이 '-아/어' 꼴(받침 없이 ㅏ·ㅓ·ㅕ·ㅐ·ㅔ·ㅘ·ㅙ·ㅝ·ㅞ로 끝남)일 때만 합침
    // ("전화 주세요", "자료 좀 주세요", "자료를 주세요"처럼 명사·조사 뒤의 '주다'는 그대로)
    .replace(/(\S+)\s+((?:주(?:세요|십시오|시겠|시면|셔서|실|셨|세|어|었|고|면|ㄹ)|줘|줄|줍)\S*)/g, (m, a: string, b: string) =>
      isAeoForm(a) ? a + b : m);
  return s ? s.split(/\s+/).length : 0;
}

/**
 * 문장 나누기 (. ? ! 뒤에서 끊음, 빈 문장 제외). 문장 길이는 이렇게 나눈 문장마다 셈(두 문장을 합쳐 세지 않음).
 * 문장부호 뒤에 띄어쓰기가 없어도 한글·따옴표가 이어지면 끊음 ("괜찮아요?내일 봐요." → 2문장)
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.?!。？！])(?:\s+|(?=[가-힣"“]))/)
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

const BEGINNER_MAX_SENTENCES = 2;
/** 문장 수에 세지 않는 한 마디 인사·사과·대답 (예: "죄송해요.", "안녕하세요.", "네."). 반말 오답 보기용 반말형도 포함 */
const SHORT_FORMULA =
  /^(?:죄송해요|죄송합니다|죄송해|미안해요|미안합니다|미안해|안녕하세요|안녕|네|예|응|아니요|아니|감사합니다|고마워요|고맙습니다|고마워|알겠어요|알겠습니다|알겠어)[.?!]?$/;
const BEGINNER_MAX_EOJEOL = 5;

/**
 * 초급 도움 범위 점검 (화면이 level을 알 때 추가로 검사). 문제가 있으면 이유, 없으면 null
 * 1) 초급 범위 밖 이유 문형: 'N 때문에·-기 때문에'(3권). '-(으)니까'는 2권 문형이라 허용하되 '죄송·감사' 앞의 '-(으)니까'는 실패
 * 2) '-ㅂ/습니다'를 탓하는 partial 보기 (초급에서는 '-ㅂ/습니다'도 맞는 높임말)
 * 3) 길이: 문장 틀·보기·모범 답이 2문장 이하, 문장당 5어절 이하 (빈칸 {{n}}은 한 어절로 셈.
 *    "죄송해요.", "안녕하세요.", "네." 같은 한 마디 인사·사과·대답 문장은 문장 수에 세지 않음)
 */
const BEGINNER_REASON_FORM = /때문에|니까\s*(?:죄송|감사|미안|고맙)/;
const BLAME_FORMAL = /딱딱|격식|말투|말끝|끝맺음|formal|stiff/i;
/** 초급 도움 위반 한 건. kind: 길이(문장 수·어절) / 어휘(위 단계 명사·금지 어휘) / 문형(3권 이상) / 내용(말투 탓, 쿠션어만 남은 문장) */
export interface BeginnerIssue {
  kind: 'length' | 'vocab' | 'form' | 'content';
  text: string;
}

/**
 * 낱말이 장면 핵심 어휘에 들어 있는지 (조사·활용이 붙어도 어절 첫머리가 같으면 같은 낱말로 봄).
 * 핵심 어휘가 동사(…다)면 어간도 비교함 (예: '미루다' → '미루', '바쁘다' → '바쁘')
 */
export function coreAllows(word: string, coreVocab: string[] = []): boolean {
  return coreVocab.some((c) => c === word || c.startsWith(word) || word.startsWith(c.endsWith('다') ? c.slice(0, -1) : c));
}

const BEGINNER_FORBIDDEN = ['경쟁력', '협력사', '납품', '분기', '예산 초과', '재발', '차질', '파악되'];

/**
 * 초급 도움 범위 점검: 위반을 모두 돌려줌(없으면 빈 배열). 화면은 위반 수로 두 결과 중 나은 쪽을 고름.
 * @param coreVocab 장면 핵심 어휘 — 위 단계 명사 검사에서 통과시킴
 */
export function beginnerSupportIssues(data: SupportData, coreVocab: string[] = []): BeginnerIssue[] {
  const issues: BeginnerIssue[] = [];
  const sentences: string[] = [];
  if (data.type === 'starter') {
    sentences.push(data.frame.template, ...data.choices.options.map((o) => o.text));
  } else if (data.type === 'frame') sentences.push(data.template);
  else if (data.type === 'choices') sentences.push(...data.options.map((o) => o.text));
  else if (data.type === 'model') sentences.push(data.text);
  for (const t of sentences) {
    if (BEGINNER_REASON_FORM.test(t)) issues.push({ kind: 'form', text: `초급 범위 밖 이유 문형: "${t}"` });
    for (const f of BEGINNER_REPLY_FORMS) if (f.test(t)) issues.push({ kind: 'form', text: `초급 범위 밖 문형 ${f.name}: "${t}"` });
    // 위 단계 명사 (예: "예약 문제"). 어절 첫머리에서만 찾고, 장면 핵심 어휘는 통과
    for (const n of BEGINNER_BANNED_NOUNS) {
      if (new RegExp(`(?:^|\\s)${n}`).test(t) && !coreAllows(n, coreVocab)) issues.push({ kind: 'vocab', text: `초급 범위 밖 어휘 '${n}': "${t}"` });
    }
    for (const w of BEGINNER_FORBIDDEN) if (t.includes(w)) issues.push({ kind: 'vocab', text: `금지 어휘 '${w}': "${t}"` });
  }
  const options = data.type === 'starter' ? data.choices.options : data.type === 'choices' ? data.options : [];
  const blamed = options.find(
    (o) => o.verdict !== 'appropriate' && /니다(?=[\s.,!?]|$)/.test(o.text) && (BLAME_FORMAL.test(o.reason) || BLAME_FORMAL.test(o.reason_en)),
  );
  if (blamed) issues.push({ kind: 'content', text: `'-ㅂ/습니다'를 탓하는 보기: "${blamed.text}" (${blamed.reason})` });
  // 쿠션어·접속어만 떼어 낸 문장 (예: "하지만요.", "혹시요.") — 실제로 쓰지 않는 말
  const stub = sentences.flatMap((t) => splitSentences(t)).find((x) => /^(?:하지만|그런데|근데|혹시|그래서|그리고|그럼)요[.?!]?$/.test(x));
  if (stub) issues.push({ kind: 'content', text: `쿠션어·접속어만 남은 문장: "${stub}"` });
  for (const t of sentences) {
    const parts = splitSentences(t);
    const counted = parts.filter((x) => !SHORT_FORMULA.test(x)).length;
    if (counted > BEGINNER_MAX_SENTENCES) issues.push({ kind: 'length', text: `문장 수 초과(${counted}문장, 최대 ${BEGINNER_MAX_SENTENCES}, 한 마디 인사·사과·대답 제외): "${t}"` });
    // 길이는 문장마다 셈 (두 문장을 합쳐 세지 않음)
    for (const x of parts) if (countEojeol(x) > BEGINNER_MAX_EOJEOL) issues.push({ kind: 'length', text: `어절 수 초과(${countEojeol(x)}어절, 최대 ${BEGINNER_MAX_EOJEOL}): "${x}"` });
  }
  return issues;
}

/** 첫 번째 위반 문구 (없으면 null). 예전 호출부·검증 스크립트 호환용 */
export function beginnerSupportIssue(data: SupportData, coreVocab: string[] = []): string | null {
  return beginnerSupportIssues(data, coreVocab)[0]?.text ?? null;
}

/**
 * 영어 칸(*_en)에 한글이 섞였는지 (화면이 붙이는 "+ 이/가" 같은 조사 안내는 빼고 봄). 섞인 필드 경로 목록
 * 사소한 문제라 실패로 처리하지 않고 개발 모드 기록용으로만 씀
 */
export function koreanInEnglishFields(data: SupportData): string[] {
  const hits: string[] = [];
  const walk = (v: unknown, path: string, key: string) => {
    if (typeof v === 'string') {
      if (key.endsWith('_en') && /[가-힣]/.test(v.replace(/\s*\+\s*[가-힣]{1,2}\/[가-힣]{1,2}\s*$/, ''))) hits.push(path);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, key));
    else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, path ? `${path}.${k}` : k, k));
  };
  walk(data, '', '');
  return hits;
}

/** 짧은 문자열 해시 (도움 캐시 키용, djb2) */
export function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** 블록 꺼내기: [[SUPPORT]]…[[/SUPPORT]], 없으면 첫 "{"부터 마지막 "}"까지. 코드 펜스는 제거 */
function supportJsonText(text: string): string | null {
  const block = text.match(/\[\[SUPPORT\]\]([\s\S]*?)\[\[\/SUPPORT\]\]/);
  let body = block ? block[1] : null;
  if (body === null) {
    const a = text.indexOf('{');
    if (a === -1) return null;
    const b = text.lastIndexOf('}');
    // 닫는 괄호가 없으면(응답이 중간에 끊김) 끝까지 가져가 파싱 실패 → 괄호 균형으로 truncated 분류
    body = b > a ? text.slice(a, b + 1) : text.slice(a);
  }
  return body.replace(/```(?:json)?/gi, '').trim();
}

/*
 * 빈칸 hint의 조사 안내는 모델에 맡기지 않고 화면이 정함.
 * 1) 모델이 쓴 조사 안내("+ 이", "와 '이/가'", "followed by 이 or 가" 등)는 지움 (틀과 어긋나는 경우가 반복됐음)
 * 2) 틀에서 빈칸 바로 뒤에 '있다/없다'가 오면 "+ 이/가"를 붙임 (거의 항상 '이/가'가 필요한 자리)
 *    단, 힌트가 숫자·개수를 가리키면 붙이지 않음 ("문제가 하나 있습니다"의 '하나'에는 '이/가'가 붙지 않음)
 */
const P1 = '(?:이|가|을|를|은|는|과|와)';
const PARTICLE_FORM = `[‘'"“]?${P1}(?:\\s*/\\s*${P1})?[’'"”]?`;
const KO_PARTICLE_TAIL = new RegExp(`\\s*(?:\\+|와|과|및)\\s*${PARTICLE_FORM}\\s*$`);
const EN_PARTICLE_TAIL = new RegExp(`\\s*,?\\s*(?:\\+|followed by|plus|and)\\s*${PARTICLE_FORM}(?:\\s*or\\s*${PARTICLE_FORM})?\\s*\\.?\\s*$`, 'i');

export function stripParticleGuide(hint: string): string {
  return hint.replace(KO_PARTICLE_TAIL, '').replace(EN_PARTICLE_TAIL, '').trim();
}

/** 힌트가 숫자·개수를 가리키는지 (예: "숫자", "문제의 수", "몇 개", "number") — 이런 빈칸에는 '이/가'가 붙지 않음 */
const QUANTITY_HINT = /숫자|개수|몇|(?:^|\s|의\s?)수(?:$|\s|\))|\bnumber\b|how many|\bcount\b/i;

/**
 * @param particle 틀에서 빈칸 바로 뒤의 조사를 화면이 뺀 경우 그 조사 쌍(예: '이/가'). 있으면 그대로 안내로 붙임
 */
export function normalizeBlankHint(template: string, blank: SupportBlank, particle?: string): SupportBlank {
  const hint = stripParticleGuide(blank.hint);
  let hintEn = stripParticleGuide(blank.hint_en).replace(/[.\s]+$/, '');
  if (particle) {
    return { ...blank, hint: `${hint || blank.hint} + ${particle}`, hint_en: hintEn ? `${hintEn} + ${particle}` : hintEn };
  }
  const isQuantity = QUANTITY_HINT.test(hint) || QUANTITY_HINT.test(hintEn);
  const needsSubject = !isQuantity && new RegExp(`\\{\\{${blank.id}\\}\\}\\s+(?:있|없)`).test(template);
  if (!needsSubject) return { ...blank, hint: hint || blank.hint, hint_en: hintEn };
  if (hintEn) hintEn = `${hintEn} + 이/가`;
  return { ...blank, hint: `${hint || blank.hint} + 이/가`, hint_en: hintEn };
}

const PARTICLE_PAIR: Record<string, string> = { 이: '이/가', 가: '이/가', 을: '을/를', 를: '을/를', 은: '은/는', 는: '은/는', 과: '과/와', 와: '과/와', 로: '(으)로', 으로: '(으)로' };
// '로/으로'도 받침에 따라 바뀜 ("{{1}}로 해결" + '계약 변경' → '변경로' ×)
const P2 = '\\(?(으로|이|가|을|를|은|는|과|와|로)\\)?';
/** 빈칸 바로 뒤의 고정 조사 (한 형태, "이/가"처럼 두 형태, "(이)" 모두). 뒤에는 공백·문장부호·끝이 와야 함 ("{{1}}이에요"는 해당 없음) */
const FIXED_PARTICLE_AFTER_BLANK = new RegExp(`\\{\\{(\\d+)\\}\\}${P2}(?:\\s*/\\s*\\(?(?:이|가|을|를|은|는|과|와)\\)?)?(?=[\\s.,!?)]|$)`, 'g');

/** {{n}} 번호와 blanks id 일치, 빈칸 1~3개, hint 필수. 빈칸 뒤 고정 조사는 고쳐 씀 */
export function validateFrame(v: unknown): SupportFrameBody | string {
  if (!v || typeof v !== 'object') return 'frame이 객체가 아님';
  const f = v as Record<string, unknown>;
  if (!isNonEmpty(f.template)) return 'template 없음';
  const nums = [...f.template.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const uniq = [...new Set(nums)].sort((a, b) => a - b);
  if (uniq.length < 1 || uniq.length > 3) return '빈칸 개수가 1~3개가 아님';
  // 빈칸 바로 뒤에 받침에 따라 바뀌는 조사가 고정돼 있으면(예: "{{2}}이 있습니다", "{{2}}이/가 있어요", "{{2}}(이) 있어요")
  // 학습자가 바르게 채워도 틀린 문장이 될 수 있음 → 버리지 않고 화면이 고쳐 씀:
  // 틀에서 조사를 빼고, 그 빈칸 힌트에 "+ 이/가"처럼 조사 쌍을 붙여 학습자가 조사까지 쓰게 함
  const repairedParticle: Record<number, string> = {};
  // 낱말 일부만 빈칸인 경우("{{1}}요일에" → 학습자가 '화요일'을 쓰면 '화요일요일') → 빈칸이 낱말 전체가 되게 '요일'을 뺌
  const template = f.template.replace(/\{\{(\d+)\}\}요일/g, '{{$1}}').replace(FIXED_PARTICLE_AFTER_BLANK, (_m, n: string, p: string) => {
    repairedParticle[Number(n)] = PARTICLE_PAIR[p];
    return `{{${n}}}`;
  });
  // 빈칸이 문장 끝에 있으면 학습자가 서술어·어미까지 직접 만들어야 함 (예: "장소 계약에 {{2}}.")
  if (/\{\{\d+\}\}\s*(?:[.?!。]|$)/.test(template.trim())) return '빈칸이 문장 끝에 있음 (빈칸 뒤에 서술어가 없음)';
  if (!Array.isArray(f.blanks)) return 'blanks가 배열이 아님';
  const blanks: SupportBlank[] = [];
  for (const raw of f.blanks) {
    if (!raw || typeof raw !== 'object') return 'blank 항목이 객체가 아님';
    const b = raw as Record<string, unknown>;
    const id = typeof b.id === 'number' ? b.id : Number(b.id);
    if (!Number.isInteger(id)) return 'blank id가 숫자가 아님';
    if (!isNonEmpty(b.hint)) return `blank ${id}의 hint 없음`;
    blanks.push(normalizeBlankHint(template, { id, hint: b.hint.trim(), hint_en: asStr(b.hint_en).trim() }, repairedParticle[id]));
  }
  const ids = [...new Set(blanks.map((b) => b.id))].sort((a, b) => a - b);
  if (ids.length !== blanks.length) return 'blank id 중복';
  if (JSON.stringify(ids) !== JSON.stringify(uniq)) return 'template의 {{n}}과 blanks id가 다름';
  return { template: template.trim(), blanks };
}

/** 보기 정확히 3개, verdict는 appropriate·partial·inappropriate 각 1개 */
export function validateChoices(v: unknown): SupportChoicesBody | string {
  if (!v || typeof v !== 'object') return 'choices가 객체가 아님';
  const c = v as Record<string, unknown>;
  if (!Array.isArray(c.options) || c.options.length !== 3) return '보기가 정확히 3개가 아님';
  const options: SupportChoiceOption[] = [];
  for (const raw of c.options) {
    if (!raw || typeof raw !== 'object') return '보기 항목이 객체가 아님';
    const o = raw as Record<string, unknown>;
    if (!isNonEmpty(o.text) || !isNonEmpty(o.reason)) return '보기의 text 또는 reason 없음';
    if (o.verdict !== 'appropriate' && o.verdict !== 'partial' && o.verdict !== 'inappropriate') return 'verdict 값이 잘못됨';
    options.push({
      id: isNonEmpty(o.id) ? o.id.trim() : String(options.length + 1),
      text: o.text.trim(),
      verdict: o.verdict,
      reason: o.reason.trim(),
      reason_en: asStr(o.reason_en).trim(),
    });
  }
  // 문장이 똑같은 보기가 둘 이상이면 학습자가 고를 수 없음 (공백·문장부호만 다른 것도 같은 문장으로 봄)
  if (new Set(options.map((o) => normalizeUtterance(o.text))).size !== options.length) return '문장이 똑같은 보기가 있음';
  // 한 보기 안에서 같은 문장을 두 번 쓴 보기 (예: "행사를 해요. 행사를 해요.") — 실제로 쓰지 않는 말
  const repeated = options.find((o) => {
    const parts = splitSentences(o.text).map(normalizeUtterance).filter(Boolean);
    return new Set(parts).size !== parts.length;
  });
  if (repeated) return `한 보기 안에 같은 문장이 반복됨: "${repeated.text}"`;
  const count = (vd: SupportVerdict) => options.filter((o) => o.verdict === vd).length;
  if (count('appropriate') !== 1 || count('partial') !== 1 || count('inappropriate') !== 1) {
    return 'verdict 구성이 appropriate·partial·inappropriate 각 1개가 아님';
  }
  return { options };
}

/** 문자열 밖의 { } 균형 (양수면 닫는 괄호가 모자람 → 잘린 응답) */
function braceBalance(body: string): number {
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') depth--;
  }
  return depth + (inStr ? 1 : 0);
}

const PLACEHOLDER = /\{\{\s*\d+\s*\}\}/;

/** frame.template(키 'template')을 뺀 모든 문자열 필드에서 빈칸 기호를 찾아 위치를 돌려줌 */
function findPlaceholder(v: unknown, path: string): string | null {
  if (typeof v === 'string') return PLACEHOLDER.test(v) ? path : null;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const hit = findPlaceholder(v[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (v && typeof v === 'object') {
    for (const [k, val] of Object.entries(v)) {
      if (k === 'template') continue;
      const hit = findPlaceholder(val, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 도움 응답 파싱 + 구조 검증 + 실패 분류.
 * - truncated: 닫는 [[/SUPPORT]]가 없거나 괄호가 닫히지 않음 (응답이 중간에 끊김)
 * - parse: JSON을 찾지 못했거나 파싱 실패
 * - schema: 필드 구조 검증 실패
 * - placeholder: frame.template 밖(보기·힌트·모범 답 등)에 {{n}}이 있음
 */
export function extractSupport(text: string, expected: SupportKind): SupportParseResult {
  const raw = text || '';
  if (raw.includes('[[SUPPORT]]') && !raw.includes('[[/SUPPORT]]')) {
    return { ok: false, kind: 'truncated', error: '닫는 [[/SUPPORT]] 없음' };
  }
  const r = extractSupportInner(raw, expected);
  if (!r.ok) {
    if (r.error === 'JSON 파싱 실패') {
      const body = supportJsonText(raw) ?? '';
      return { ok: false, kind: braceBalance(body) > 0 ? 'truncated' : 'parse', error: r.error };
    }
    return { ok: false, kind: r.error === 'JSON을 찾지 못함' || r.error === 'JSON이 객체가 아님' ? 'parse' : 'schema', error: r.error };
  }
  const hit = findPlaceholder(r.data, '');
  if (hit) return { ok: false, kind: 'placeholder', error: `${hit}에 빈칸 기호({{n}})가 있음` };
  if (r.data.type === 'starter') {
    // 정답 보기가 문장 틀을 채운 문장과 다른 구조면 학습자가 빈칸에 무엇을 넣을지 알 수 없음 → 실패.
    // 같은 구조면 정답 보기의 빈칸 값 끝 조사를 틀에 옮겨 적음
    const answer = r.data.choices.options.find((o) => o.verdict === 'appropriate')?.text ?? '';
    const aligned = alignFrameWithAnswer(r.data.frame, answer);
    if (!aligned.matched) return { ok: false, kind: 'schema', error: 'starter: 문장 틀과 정답 보기가 같은 구조가 아님' };
    return { ok: true, data: { ...r.data, frame: aligned.frame } };
  }
  return r;
}

/*
 * 문장 틀과 정답 보기 맞추기.
 * 정답 보기를 틀에 대어 빈칸 값을 뽑고, 값이 바뀌지 않는 조사(에·에서·까지·부터·에게·한테)로 끝나는데
 * 틀의 빈칸 뒤에 그 조사가 없으면 틀에 조사를 옮겨 적음. (예: 틀 "{{1}} 출장 중이에요" + 정답 "목요일에 출장 중이에요"
 * → 틀 "{{1}}에 출장 중이에요") 학습자가 힌트대로 명사만 써도 정답과 같은 문장이 되게 하기 위함.
 * matched: 정답 보기가 틀을 채운 문장과 같은 구조인지 (대체 경로에서 틀과 보기를 따로 받을 때 확인용)
 */
const CARRY_PARTICLES = ['에서', '에게', '한테', '까지', '부터', '에'];
const stripPunct = (t: string) => t.replace(/[.,!?。？！"'“”‘’]/g, '').trim();
export function alignFrameWithAnswer(frame: SupportFrameBody, answer: string): { frame: SupportFrameBody; matched: boolean } {
  const parts = stripPunct(frame.template).split(/(\{\{\d+\}\})/);
  const ids: number[] = [];
  const pattern = parts
    .map((p) => {
      const m = p.match(/^\{\{(\d+)\}\}$/);
      if (m) {
        ids.push(Number(m[1]));
        // 빈칸 값은 공백이 아닌 글자로 시작하고 끝나야 함 (문장 사이 공백 하나가 빈칸 값으로 잡히지 않게)
        return '(\\S(?:.*?\\S)?)';
      }
      return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
    })
    .join('');
  const hit = stripPunct(answer).match(new RegExp(`^${pattern}$`));
  if (!hit) return { frame, matched: false };
  let template = frame.template;
  ids.forEach((id, i) => {
    const value = hit[i + 1].trim();
    const after = template.split(`{{${id}}}`)[1] ?? '';
    const p = CARRY_PARTICLES.find((x) => value.endsWith(x) && value.length > x.length);
    if (p && !after.startsWith(p)) template = template.replace(`{{${id}}}`, `{{${id}}}${p}`);
  });
  return { frame: { ...frame, template }, matched: true };
}

/** 파싱 + 구조 검증 (실패해도 예외를 던지지 않음). expected: 요청한 도움 종류 (응답의 type과 같아야 함) */
function extractSupportInner(text: string, expected: SupportKind): InnerResult {
  const body = supportJsonText(text || '');
  if (!body) return { ok: false, error: 'JSON을 찾지 못함' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: 'JSON 파싱 실패' };
  }
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'JSON이 객체가 아님' };
  const p = parsed as Record<string, unknown>;
  if (p.type !== expected) return { ok: false, error: `type이 ${expected}가 아님` };
  // 어느 상대역 발화에 대한 도움인지 (화면이 실제 마지막 발화와 비교함)
  if (!isNonEmpty(p.replyTo)) return { ok: false, error: 'replyTo 없음' };
  const meta: SupportMeta = { replyTo: p.replyTo.trim(), intent: asStr(p.intent).trim(), intent_en: asStr(p.intent_en).trim() };

  if (expected === 'hint') {
    if (!Array.isArray(p.steps) || p.steps.length < 2 || p.steps.length > 3 || !p.steps.every(isNonEmpty)) {
      return { ok: false, error: 'steps가 2~3개의 문장이 아님' };
    }
    const steps = (p.steps as string[]).map((x) => x.trim());
    let stepsEn: string[];
    // 중급·고급은 영어 칸을 비우므로 steps_en이 없거나 빈 배열·빈 문자열이어도 받음
    if (p.steps_en === undefined || p.steps_en === '' || (Array.isArray(p.steps_en) && p.steps_en.length === 0)) stepsEn = steps.map(() => '');
    else if (Array.isArray(p.steps_en) && p.steps_en.length === steps.length) stepsEn = p.steps_en.map((x) => asStr(x).trim());
    else return { ok: false, error: 'steps_en 개수가 steps와 다름' };
    return { ok: true, data: { ...meta, type: 'hint', steps, steps_en: stepsEn } };
  }
  if (expected === 'frame') {
    const f = validateFrame(p);
    return typeof f === 'string' ? { ok: false, error: f } : { ok: true, data: { ...meta, type: 'frame', ...f } };
  }
  if (expected === 'choices') {
    const c = validateChoices(p);
    return typeof c === 'string' ? { ok: false, error: c } : { ok: true, data: { ...meta, type: 'choices', ...c } };
  }
  if (expected === 'model') {
    if (!isNonEmpty(p.text) || !isNonEmpty(p.tip)) return { ok: false, error: 'text 또는 tip 없음' };
    return {
      ok: true,
      data: { ...meta, type: 'model', text: p.text.trim(), text_en: asStr(p.text_en).trim(), tip: p.tip.trim(), tip_en: asStr(p.tip_en).trim() },
    };
  }
  // starter
  const f = validateFrame(p.frame);
  if (typeof f === 'string') return { ok: false, error: `starter.frame: ${f}` };
  const c = validateChoices(p.choices);
  if (typeof c === 'string') return { ok: false, error: `starter.choices: ${c}` };
  return { ok: true, data: { ...meta, type: 'starter', frame: f, choices: c } };
}

/** 도움 문장 목록 (문장 틀은 빈칸을 한 어절로 바꿔 셈) */
function supportSentences(data: SupportData): string[] {
  if (data.type === 'starter') return [data.frame.template.replace(/\{\{\d+\}\}/g, '빈칸'), ...data.choices.options.map((o) => o.text)];
  if (data.type === 'frame') return [data.template.replace(/\{\{\d+\}\}/g, '빈칸')];
  if (data.type === 'choices') return data.options.map((o) => o.text);
  if (data.type === 'model') return [data.text];
  return [];
}

const LEVEL_MAX_EOJEOL: Record<string, number> = { 초급: 5, 중급: 7, 고급: 8 };

/** 중급·고급 도움 문장 길이 점검 (문장당 최대 어절, docs/level-guide.md 1-2). 넘으면 이유, 아니면 null */
export function supportLengthIssue(data: SupportData, level: string): string | null {
  const max = LEVEL_MAX_EOJEOL[level];
  if (!max) return null;
  for (const t of supportSentences(data)) {
    const long = splitSentences(t).find((x) => countEojeol(x) > max);
    if (long) return `어절 수 초과(${countEojeol(long)}어절, 최대 ${max}): "${long}"`;
  }
  return null;
}

/**
 * 학습자가 이미 말한 문장을 도움 문장(문장 틀·정답 보기·모범 답)에 다시 넣었는지.
 * 짧은 대답("네.", "좋아요.")은 겹쳐도 괜찮으므로 정규화 후 6자 이상인 문장만 봄
 */
export function repeatsLearner(data: SupportData, learnerSaid: string[]): string | null {
  const said = learnerSaid.flatMap((t) => splitSentences(t)).map(normalizeUtterance).filter((x) => x.length >= 6);
  if (said.length === 0) return null;
  const answer = data.type === 'starter' ? data.choices.options.find((o) => o.verdict === 'appropriate')?.text ?? ''
    : data.type === 'choices' ? data.options.find((o) => o.verdict === 'appropriate')?.text ?? '' : '';
  const own = [...(data.type === 'starter' || data.type === 'frame' ? supportSentences(data).slice(0, 1) : []), answer, data.type === 'model' ? data.text : '']
    .flatMap((t) => splitSentences(t)).map(normalizeUtterance).filter(Boolean);
  const hit = own.find((x) => said.includes(x));
  return hit ? `학습자가 이미 말한 문장을 반복: "${hit}"` : null;
}

/* ------------------------------------------------------------------ */
/* 초급 롤플레이 상대역 발화 점검 (화면이 검사하고, 어긋나면 1회 다시 받음) */
/* ------------------------------------------------------------------ */

/**
 * 초급에서 쓰지 않는 위 단계 명사 (api/_lib/level-rules.ts VOCAB의 중급·고급 명사와 같아야 함 — tests/meta.test.ts가 확인).
 * src와 api는 서로 import하지 않으므로 목록을 옮겨 둠. 동사(늦다 등)는 초급 장면 문구에도 쓰여 검사하지 않음.
 */
export const BEGINNER_BANNED_NOUNS = ['일정', '출장', '손님', '고객', '거래처', '발표', '계획', '결과', '제품', '주문', '예약', '회신', '첨부 파일', '담당자'];

/** 받침이 ㄹ인 글자인지 (예: '할'·'볼' → '-(으)ㄹ게요' 판별용) */
function endsWithRieul(ch: string): boolean {
  const code = ch.charCodeAt(0) - 0xac00;
  return code >= 0 && code <= 11171 && code % 28 === 8;
}

/** 초급 범위 밖 문형 (3권 이상). 오탐이 적은 형태만 검사함 ('-(으)면'은 '그러면' 등과 구분이 어려워 제외) */
const BEGINNER_REPLY_FORMS: { name: string; test: (s: string) => boolean }[] = [
  { name: "'-군요'", test: (s) => /군요/.test(s) },
  { name: "'N 때문에·-기 때문에'", test: (s) => /때문에/.test(s) },
  { name: "'-겠-'(알겠습니다 제외)", test: (s) => /(?<!알)겠(?:습니다|어요|네요|지요|죠)/.test(s) },
  { name: "'-(으)ㄹ게요'", test: (s) => [...s.matchAll(/(.)게요/g)].some((m) => endsWithRieul(m[1])) },
  { name: "'-고 있다'", test: (s) => /\S고\s+있(?:어|습|었|는)/.test(s) },
  { name: "'-(으)ㄹ 것 같다'", test: (s) => /것\s*같/.test(s) },
  { name: "'-(으)ㄹ 거예요'", test: (s) => /거예요|겁니다/.test(s) },
  { name: "'-아/어야 하다'(4권)", test: (s) => /[가-힣]야\s*(?:해요|해|합니다|했어요|하고|해서|하는)(?=[\s.,!?]|$)/.test(s) },
];

/**
 * 초급 상대역 발화가 초급 기준(docs/level-guide.md 1장)을 넘는지. 문제 목록(없으면 빈 배열)을 돌려줌.
 * - 괄호 안("(도움말) …", "(대화를 마치려면 …)")은 빼고 검사
 * - 한 번에 최대 2문장("네.", "죄송해요." 같은 한 마디는 세지 않음), 문장당 5어절
 * - 3권 이상 문형, 위 단계 명사, 금지 어휘
 * @param learnerSaid 학습자가 이미 쓴 말. 학습자가 먼저 쓴 낱말을 상대역이 받아 말하는 것은 허용
 */
export function beginnerReplyIssues(reply: string, learnerSaid: string[] = [], coreVocab: string[] = []): string[] {
  const text = cleanDisplayContent(reply).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const issues: string[] = [];
  const sentences = splitSentences(text);
  const counted = sentences.filter((x) => !SHORT_FORMULA.test(x)).length;
  if (counted > BEGINNER_MAX_SENTENCES) issues.push(`문장 수 초과(${counted}문장, 최대 ${BEGINNER_MAX_SENTENCES})`);
  for (const s of sentences) {
    const n = countEojeol(s);
    if (n > BEGINNER_MAX_EOJEOL) issues.push(`어절 수 초과(${n}어절, 최대 ${BEGINNER_MAX_EOJEOL}): "${s}"`);
  }
  for (const f of BEGINNER_REPLY_FORMS) if (f.test(text)) issues.push(`초급 범위 밖 문형 ${f.name}`);
  const learner = learnerSaid.join(' ');
  for (const w of BEGINNER_BANNED_NOUNS) {
    // 어절 첫머리에서만 찾음 (다른 낱말 안에 우연히 들어간 경우 제외)
    if (new RegExp(`(?:^|\\s)${w}`).test(text) && !learner.includes(w) && !coreAllows(w, coreVocab)) issues.push(`위 단계 어휘 '${w}'`);
  }
  for (const w of ['경쟁력', '협력사', '납품', '분기', '예산 초과', '재발', '차질', '파악되']) if (text.includes(w)) issues.push(`금지 어휘 '${w}'`);
  return issues;
}

/* ------------------------------------------------------------------ */
/* 도움 응답 검사 결과 나누기: 구조 실패(오류 처리) / 난이도 실패(완화 처리)      */
/* ------------------------------------------------------------------ */

/** 도움 응답 안에 새어 나온 내부 표시 (출처 표시, 서버·화면이 붙이는 블록 이름) */
const SUPPORT_INTERNAL = /\[(?:Y\d+-\d+[^\]]*|보충[^\]]*|격식|난이도:[^\]]*|이미 소개한 문형|이미 쓴 대표 문장|도움 사용 기록|서버 안내|도움 요청|지금 대답할 상대역의 말|학습자가 이미 말한 내용|문장 틀)\]/;

/** 문자열 필드 중 내부 표시가 있는 첫 위치 (없으면 null) */
export function internalMarkerField(v: unknown, path = ''): string | null {
  if (typeof v === 'string') return SUPPORT_INTERNAL.test(v) ? path || '(값)' : null;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const hit = internalMarkerField(v[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const hit = internalMarkerField(x, path ? `${path}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * 난이도 실패 목록 (완화 처리 대상, 없으면 빈 배열).
 * - 초급: 초급 범위 점검(길이·어휘·문형·내용) — 장면 핵심 어휘는 통과
 * - 중급·고급: 문장마다 최대 어절
 * - 모든 난이도: 학습자가 이미 말한 문장 반복
 */
export function supportDifficultyIssues(data: SupportData, level: string, learnerSaid: string[] = [], coreVocab: string[] = []): string[] {
  const out = level === '초급' ? beginnerSupportIssues(data, coreVocab).map((i) => i.text) : [supportLengthIssue(data, level)].filter((x): x is string => !!x);
  const rep = repeatsLearner(data, learnerSaid);
  if (rep) out.push(rep);
  return out;
}

/** 두 결과 중 난이도 위반이 적은 쪽 (같으면 나중 결과) */
export function pickLessDifficult<T>(a: { data: T; issues: string[] } | null, b: { data: T; issues: string[] } | null): { data: T; issues: string[] } | null {
  if (!a) return b;
  if (!b) return a;
  return b.issues.length <= a.issues.length ? b : a;
}
