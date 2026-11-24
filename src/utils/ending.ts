import { normalizeUtterance, splitSentences, stripMetaForHistory } from './meta';

/**
 * 롤플레이 대화 종료 감지 (모델이 [[END]]를 빠뜨렸을 때의 안전장치). React와 무관한 순수 함수.
 * 학습자 발화가 3번 이상인 대화에서만 판단함(대화 첫머리의 "안녕하세요" 같은 인사로 끝내지 않도록).
 */

/** 끝인사 표현. "안녕하세요"(첫인사)는 넣지 않음 */
export const CLOSING_PHRASES = [
  '감사합니다',
  '감사해요',
  '고맙습니다',
  '고마워요',
  '뵙겠습니다',
  '뵐게요',
  '봬요',
  '뵈어요',
  '뵈요',
  '들어가세요',
  '수고하세요',
  '수고하셨습니다',
  '수고하셨어요',
  '안녕히 계세요',
  '안녕히 가세요',
  '좋은 하루',
];

/** 감지에 필요한 최소 학습자 발화 수 */
export const MIN_LEARNER_TURNS = 3;
/** "거의 같음" 기준: 정규화한 두 문자열의 유사도 */
export const SIMILARITY_THRESHOLD = 0.8;
/** 반복 감지에 쓰는 최소 길이(공백·문장부호 제외 글자 수). "네.", "좋아요." 같은 짧은 대답이 두 번 나와도 끝내지 않음 */
export const MIN_REPEAT_LENGTH = 6;

/**
 * 끝인사가 담긴 말인지. 끝인사 표현이 있고, 마지막 문장이 질문이 아니어야 함
 * ("감사합니다. 그럼 목요일 괜찮으세요?"처럼 감사 뒤에 질문을 이어 가는 말은 끝인사로 보지 않음)
 */
export function isClosingUtterance(text: string): boolean {
  const t = stripMetaForHistory(text || '').replace(/\([^)]*\)/g, ' ').trim();
  if (!t) return false;
  const squeezed = t.replace(/\s+/g, '');
  if (!CLOSING_PHRASES.some((p) => squeezed.includes(p.replace(/\s+/g, '')))) return false;
  const sentences = splitSentences(t);
  const last = sentences[sentences.length - 1] ?? '';
  return !/[?？]\s*$/.test(last);
}

/** 편집 거리 (Levenshtein) */
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * 두 발화가 거의 같은지: 공백·문장부호를 지우고 비교해서 한쪽이 다른 쪽을 포함하거나 유사도(1 - 편집 거리/긴 쪽 길이)가 0.8 이상.
 * 둘 중 하나라도 MIN_REPEAT_LENGTH보다 짧으면 같다고 보지 않음
 */
export function nearlySame(a: string, b: string): boolean {
  const x = normalizeUtterance(stripMetaForHistory(a || ''));
  const y = normalizeUtterance(stripMetaForHistory(b || ''));
  if (x.length < MIN_REPEAT_LENGTH || y.length < MIN_REPEAT_LENGTH) return false;
  if (x.includes(y) || y.includes(x)) return true;
  const longer = Math.max(x.length, y.length);
  return 1 - editDistance(x, y) / longer >= SIMILARITY_THRESHOLD;
}

export type EndingReason = 'assistant-repeat' | 'learner-repeat' | 'closing-exchange';

export interface TurnMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * 반복·끝인사 교환으로 대화가 끝났는지. 끝났으면 이유, 아니면 null.
 * @param messages 다 받은 대화 기록(스트리밍 중·빈 메시지 제외, 피드백 요청 전)
 */
export function detectEnding(messages: TurnMessage[]): EndingReason | null {
  const turns = messages.filter((m) => m.content.trim() !== '' && (m.role === 'user' || m.role === 'assistant'));
  const learner = turns.filter((m) => m.role === 'user');
  if (learner.length < MIN_LEARNER_TURNS) return null;
  const assistant = turns.filter((m) => m.role === 'assistant');
  if (assistant.length >= 2 && nearlySame(assistant[assistant.length - 1].content, assistant[assistant.length - 2].content)) return 'assistant-repeat';
  if (nearlySame(learner[learner.length - 1].content, learner[learner.length - 2].content)) return 'learner-repeat';
  // 마지막이 상대역의 끝인사이고, 바로 앞 학습자 발화도 끝인사
  const last = turns[turns.length - 1];
  const prev = turns[turns.length - 2];
  if (last?.role === 'assistant' && prev?.role === 'user' && isClosingUtterance(last.content) && isClosingUtterance(prev.content)) return 'closing-exchange';
  return null;
}

export type EndingDecision = 'marker' | EndingReason | null;

/**
 * 상대역 응답을 다 받은 뒤 종료 상태로 바꿀지.
 * - 응답(또는 초급 다시 받기 전의 처음 응답)에 [[END]]가 있으면 'marker'
 * - 아니면 반복·끝인사 감지(detectEnding). 단 [대화 이어 가기]로 다시 연 뒤에는 이어 간 지점(fromIndex)부터의 대화만 봄
 * @param messages 응답까지 포함한 대화 기록
 * @param replies 이번 차례에 받은 응답 원문들 (처음 응답, 다시 받은 응답)
 */
export function decideEnding(messages: TurnMessage[], replies: string[], fromIndex = 0): EndingDecision {
  if (replies.some((r) => /\[\[END\]\]/.test(r || ''))) return 'marker';
  return detectEnding(messages.slice(Math.max(0, fromIndex)));
}
