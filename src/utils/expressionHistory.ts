import { stripSourceTags } from './meta';

/**
 * 표현 연습에서 이미 소개한 문형·대표 문장을 코드가 직접 기록하고,
 * "다른 표현"/"퀴즈 시작"을 보낼 때 API 전송용 메시지 끝에 붙일 블록을 만듭니다.
 * (모델이 대화 기록만 보고 중복을 피하게 두면 같은 문형·예시 문장이 반복되는 문제가 있었음)
 */

export interface ExpressionHistory {
  patterns: string[];
  sentences: string[];
}

export const EMPTY_HISTORY: ExpressionHistory = { patterns: [], sentences: [] };

/** 블록에 담는 최대 개수 (각각 최근 N개) */
export const HISTORY_SEND_LIMIT = 30;

/** 블록을 붙일 명령어 (버튼·직접 입력 모두) */
const COMMANDS = ['다른 표현', '표현 더 보기', '다른 문형', '퀴즈 시작', '퀴즈시작'];

export function isHistoryCommand(text: string): boolean {
  const t = text.trim().replace(/[.!?。]+$/, '');
  return COMMANDS.includes(t);
}

/** 줄 앞의 "-", "•", "·", "*", 공백과 마크다운 기호(**, `)를 지우고 비교용으로 정리 */
function cleanLine(text: string): string {
  return stripSourceTags(text)
    .replace(/\*\*|`/g, '')
    .replace(/^[\s\-•·*]+/, '')
    .replace(/\s*\(복습\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 표현 소개 응답에서 문형("문형:" 줄의 값)과 대표 문장(번호가 붙은 항목 제목 줄)을 뽑습니다.
 * "문형:" 줄이 없는 응답(퀴즈·채점·일반 답변)에서는 아무것도 뽑지 않습니다.
 */
export function extractIntroItems(reply: string): ExpressionHistory {
  const lines = (reply || '').split('\n');
  const patterns: string[] = [];
  for (const line of lines) {
    const m = line.match(/^[\s\-•·*]*(?:\*\*)?문형(?:\*\*)?\s*[:：]\s*(.+)$/);
    if (m) {
      const value = cleanLine(m[1]);
      if (value) patterns.push(value);
    }
  }
  if (patterns.length === 0) return { patterns: [], sentences: [] };

  const sentences: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*\d+\.\s+(.+)$/);
    if (m) {
      const value = cleanLine(m[1]);
      if (value) sentences.push(value);
    }
  }
  return { patterns, sentences };
}

function appendUnique(list: string[], items: string[]): string[] {
  const next = [...list];
  for (const item of items) {
    if (!next.includes(item)) next.push(item);
  }
  return next;
}

export function mergeHistory(prev: ExpressionHistory, reply: string): ExpressionHistory {
  const found = extractIntroItems(reply);
  if (found.patterns.length === 0 && found.sentences.length === 0) return prev;
  return {
    patterns: appendUnique(prev.patterns, found.patterns),
    sentences: appendUnique(prev.sentences, found.sentences),
  };
}

/** API 전송용 메시지 끝에 붙일 블록 (기록이 비어 있으면 빈 문자열) */
export function buildHistoryBlock(history: ExpressionHistory): string {
  const patterns = history.patterns.slice(-HISTORY_SEND_LIMIT);
  const sentences = history.sentences.slice(-HISTORY_SEND_LIMIT);
  if (patterns.length === 0 && sentences.length === 0) return '';
  return `\n\n[이미 소개한 문형]\n${patterns.join(', ')}\n[이미 쓴 대표 문장]\n${sentences.join(' / ')}`;
}
