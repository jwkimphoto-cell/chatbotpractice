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
