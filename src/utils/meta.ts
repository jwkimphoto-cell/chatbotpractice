export type NoteCategory = '높임법' | '완곡 표현' | '보고 순서' | '어휘·문법';

export interface ParsedNoteItem {
  scene: string;
  counterpart: string;
  original: string;
  corrected: string;
  category: NoteCategory;
  reason: string;
}

export interface ParsedResult {
  correct: boolean;
}

const ALLOWED_CATEGORIES: NoteCategory[] = ['높임법', '완곡 표현', '보고 순서', '어휘·문법'];

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
 * 응답 텍스트에서 [[RESULT]] ... [[/RESULT]] 블록을 추출하여 채점 결과를 반환
 */
export function extractResult(text: string): ParsedResult | null {
  if (!text) return null;

  const match = text.match(/\[\[RESULT\]\]([\s\S]*?)\[\[\/RESULT\]\]/);
  if (!match || !match[1]) return null;

  try {
    const parsed = JSON.parse(match[1].trim());
    if (parsed && typeof parsed.correct === 'boolean') {
      return { correct: parsed.correct };
    }
    return null;
  } catch {
    return null;
  }
}
