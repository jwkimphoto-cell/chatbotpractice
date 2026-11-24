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

/**
 * 화면 표시용 텍스트 정제:
 * 1) [[NOTES]] 또는 [[RESULT]] 시작점부터 뒤쪽 전체를 숨김
 * 2) 스트리밍 중 마커 앞부분(예: "[[", "[[N", "[[NOTES", "[[R" 등)으로 끝나는 꼬리도 숨김
 */
export function cleanDisplayContent(text: string): string {
  if (!text) return '';

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
  const partialMarkerRegex = /\[(?:\[(?:N(?:O(?:T(?:E(?:S(?:\])?)?)?)?)?|R(?:E(?:S(?:U(?:L(?:T(?:\])?)?)?)?)?)?)?)?$/;
  return text.replace(partialMarkerRegex, '').trimEnd();
}

/**
 * 대화 기록을 서버로 다시 보낼 때 메타 블록([[NOTES]]...[[/NOTES]], [[RESULT]]...[[/RESULT]])을 제거
 */
export function stripMetaForHistory(text: string): string {
  if (!text) return '';
  return text
    .replace(/\[\[NOTES\]\][\s\S]*?\[\[\/NOTES\]\]/g, '')
    .replace(/\[\[RESULT\]\][\s\S]*?\[\[\/RESULT\]\]/g, '')
    // 닫는 마커 없이 잘린 메타 블록은 시작 마커부터 끝까지 제거
    .replace(/\[\[(?:NOTES|RESULT)\]\][\s\S]*$/, '')
    .trim();
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
    const rawJson = match[1].trim();
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
        ALLOWED_CATEGORIES.includes(item.category)
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
    const parsed = JSON.parse(match[1].trim());
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
export type SupportData =
  | SupportHint
  | ({ type: 'frame' } & SupportFrameBody)
  | ({ type: 'choices' } & SupportChoicesBody)
  | SupportModel
  | { type: 'starter'; frame: SupportFrameBody; choices: SupportChoicesBody };

export type SupportParseResult = { ok: true; data: SupportData } | { ok: false; error: string };

const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 블록 꺼내기: [[SUPPORT]]…[[/SUPPORT]], 없으면 첫 "{"부터 마지막 "}"까지. 코드 펜스는 제거 */
function supportJsonText(text: string): string | null {
  const block = text.match(/\[\[SUPPORT\]\]([\s\S]*?)\[\[\/SUPPORT\]\]/);
  let body = block ? block[1] : null;
  if (body === null) {
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a === -1 || b <= a) return null;
    body = text.slice(a, b + 1);
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

export function normalizeBlankHint(template: string, blank: SupportBlank): SupportBlank {
  const hint = stripParticleGuide(blank.hint);
  let hintEn = stripParticleGuide(blank.hint_en).replace(/[.\s]+$/, '');
  const isQuantity = QUANTITY_HINT.test(hint) || QUANTITY_HINT.test(hintEn);
  const needsSubject = !isQuantity && new RegExp(`\\{\\{${blank.id}\\}\\}\\s+(?:있|없)`).test(template);
  if (!needsSubject) return { ...blank, hint: hint || blank.hint, hint_en: hintEn };
  if (hintEn) hintEn = `${hintEn} + 이/가`;
  return { ...blank, hint: `${hint || blank.hint} + 이/가`, hint_en: hintEn };
}

/** {{n}} 번호와 blanks id 일치, 빈칸 1~3개, hint 필수 */
export function validateFrame(v: unknown): SupportFrameBody | string {
  if (!v || typeof v !== 'object') return 'frame이 객체가 아님';
  const f = v as Record<string, unknown>;
  if (!isNonEmpty(f.template)) return 'template 없음';
  const nums = [...f.template.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const uniq = [...new Set(nums)].sort((a, b) => a - b);
  if (uniq.length < 1 || uniq.length > 3) return '빈칸 개수가 1~3개가 아님';
  // 빈칸 바로 뒤에 받침에 따라 바뀌는 조사가 고정돼 있으면, 학습자가 바르게 채워도 틀린 문장이 됨 (예: "{{2}}이 있습니다")
  if (/\{\{\d+\}\}(?:이|가|을|를|은|는|과|와)(?=[\s.,!?]|$)/.test(f.template)) return '빈칸 바로 뒤에 받침에 따라 바뀌는 조사가 있음';
  // 빈칸이 문장 끝에 있으면 학습자가 서술어·어미까지 직접 만들어야 함 (예: "장소 계약에 {{2}}.")
  if (/\{\{\d+\}\}\s*(?:[.?!。]|$)/.test(f.template.trim())) return '빈칸이 문장 끝에 있음 (빈칸 뒤에 서술어가 없음)';
  if (!Array.isArray(f.blanks)) return 'blanks가 배열이 아님';
  const blanks: SupportBlank[] = [];
  for (const raw of f.blanks) {
    if (!raw || typeof raw !== 'object') return 'blank 항목이 객체가 아님';
    const b = raw as Record<string, unknown>;
    const id = typeof b.id === 'number' ? b.id : Number(b.id);
    if (!Number.isInteger(id)) return 'blank id가 숫자가 아님';
    if (!isNonEmpty(b.hint)) return `blank ${id}의 hint 없음`;
    blanks.push(normalizeBlankHint(f.template, { id, hint: b.hint.trim(), hint_en: asStr(b.hint_en).trim() }));
  }
  const ids = [...new Set(blanks.map((b) => b.id))].sort((a, b) => a - b);
  if (ids.length !== blanks.length) return 'blank id 중복';
  if (JSON.stringify(ids) !== JSON.stringify(uniq)) return 'template의 {{n}}과 blanks id가 다름';
  return { template: f.template.trim(), blanks };
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
  const count = (vd: SupportVerdict) => options.filter((o) => o.verdict === vd).length;
  if (count('appropriate') !== 1 || count('partial') !== 1 || count('inappropriate') !== 1) {
    return 'verdict 구성이 appropriate·partial·inappropriate 각 1개가 아님';
  }
  return { options };
}

/**
 * 도움 응답 파싱 + 구조 검증. 실패해도 예외를 던지지 않고 { ok: false }를 돌려줌(화면은 [다시 시도] 표시).
 * @param expected 요청한 도움 종류 (응답의 type과 같아야 함)
 */
export function extractSupport(text: string, expected: SupportKind): SupportParseResult {
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

  if (expected === 'hint') {
    if (!Array.isArray(p.steps) || p.steps.length < 2 || p.steps.length > 3 || !p.steps.every(isNonEmpty)) {
      return { ok: false, error: 'steps가 2~3개의 문장이 아님' };
    }
    const steps = (p.steps as string[]).map((x) => x.trim());
    let stepsEn: string[];
    if (p.steps_en === undefined) stepsEn = steps.map(() => '');
    else if (Array.isArray(p.steps_en) && p.steps_en.length === steps.length) stepsEn = p.steps_en.map((x) => asStr(x).trim());
    else return { ok: false, error: 'steps_en 개수가 steps와 다름' };
    return { ok: true, data: { type: 'hint', steps, steps_en: stepsEn } };
  }
  if (expected === 'frame') {
    const f = validateFrame(p);
    return typeof f === 'string' ? { ok: false, error: f } : { ok: true, data: { type: 'frame', ...f } };
  }
  if (expected === 'choices') {
    const c = validateChoices(p);
    return typeof c === 'string' ? { ok: false, error: c } : { ok: true, data: { type: 'choices', ...c } };
  }
  if (expected === 'model') {
    if (!isNonEmpty(p.text) || !isNonEmpty(p.tip)) return { ok: false, error: 'text 또는 tip 없음' };
    return {
      ok: true,
      data: { type: 'model', text: p.text.trim(), text_en: asStr(p.text_en).trim(), tip: p.tip.trim(), tip_en: asStr(p.tip_en).trim() },
    };
  }
  // starter
  const f = validateFrame(p.frame);
  if (typeof f === 'string') return { ok: false, error: `starter.frame: ${f}` };
  const c = validateChoices(p.choices);
  if (typeof c === 'string') return { ok: false, error: `starter.choices: ${c}` };
  return { ok: true, data: { type: 'starter', frame: f, choices: c } };
}
