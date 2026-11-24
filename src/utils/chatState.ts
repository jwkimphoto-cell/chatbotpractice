import type { ChatMessage } from '../api/chat';
import { stripMetaForHistory } from './meta';

/**
 * 화면 상태 로직 중 React와 무관한 순수 함수 모음 (테스트 대상).
 * - 화면 표시용 content와 API 전송용 apiContent의 분리
 * - 도움 패널 표시 조건, 보기 선택 상태 계산
 */

export interface StoredMessage {
  id: string;
  role: ChatMessage['role'];
  /** 화면 표시용 텍스트 */
  content: string;
  /** API 전송용 텍스트 (없으면 content) */
  apiContent?: string;
}

/**
 * API 전송용 대화 기록: 화면 전용 인사말(id가 init-로 시작)과 빈 메시지(스트리밍 placeholder)는 빼고,
 * 전송용 텍스트(apiContent)가 있으면 그것을 쓰며 메타 블록([[NOTES]]·[[RESULT]])을 지움.
 */
export function buildExpressionPayload(list: StoredMessage[]): ChatMessage[] {
  return list
    .filter((m) => !m.id.startsWith('init-'))
    .map((m) => ({ role: m.role, content: stripMetaForHistory(m.apiContent ?? m.content) }))
    .filter((m) => m.content.trim() !== '');
}

/** 롤플레이 대화 기록 전송용: 빈 메시지(스트리밍 placeholder) 제외, 전송용 텍스트 우선, 메타 블록 제거 */
export function buildRoleplayPayload(list: StoredMessage[], streamingId: string | null = null): ChatMessage[] {
  return list
    .filter((m) => m.id !== streamingId)
    .map((m) => ({ role: m.role, content: stripMetaForHistory(m.apiContent ?? m.content) }))
    .filter((m) => m.content.trim() !== '');
}

export interface SupportPanelInput {
  stage: 'select-scene' | 'select-diff' | 'chat';
  feedbackRequested: boolean;
  isLoading: boolean;
  streamingId: string | null;
  messages: StoredMessage[];
  /** 대화 종료 상태 ([[END]] 또는 반복·끝인사 감지). 종료 상태에서는 패널을 숨기고 도움 요청을 보내지 않음 */
  ended?: boolean;
}
export interface SupportPanelState {
  /** 도움 패널을 마운트할지 (상대역 응답이 다 끝나고 마지막 말이 상대역일 때만) */
  showPanel: boolean;
  /** 학습자가 말을 보낸 뒤 다음 상대역 발화가 끝날 때까지 "준비 중" 안내만 보일지 */
  showWaiting: boolean;
  /** 패널이 돕는 상대역 발화 (메타 블록 제거) */
  target: string;
  /** 다 받은 상대역 발화 수 (패널 key·캐시 키에 씀) */
  turnIndex: number;
}

/** 롤플레이 도움 패널 표시 조건 (피드백 요청 뒤에는 숨김, 스트리밍 중에는 패널 대신 준비 중 안내) */
export function supportPanelState(s: SupportPanelInput): SupportPanelState {
  const done = (m: StoredMessage) => m.id !== s.streamingId && m.content.trim() !== '';
  const turnIndex = s.messages.filter((m) => m.role === 'assistant' && done(m)).length;
  const last = s.messages[s.messages.length - 1];
  const lastIsAssistant = !!last && last.role === 'assistant' && done(last);
  const hasUserTurn = s.messages.some((m) => m.role === 'user');
  const inChat = s.stage === 'chat' && !s.feedbackRequested && !s.ended;
  const showPanel = inChat && lastIsAssistant && !s.isLoading;
  const showWaiting = inChat && !showPanel && s.isLoading && hasUserTurn;
  return { showPanel, showWaiting, target: lastIsAssistant ? stripMetaForHistory(last.content) : '', turnIndex };
}

export interface ChoiceOptionLike {
  id: string;
  verdict: 'appropriate' | 'partial' | 'inappropriate';
}
export interface ChoiceState {
  /** 틀린 보기를 고른 횟수 */
  wrongCount: number;
  /** 정답 보기를 골랐는지 */
  pickedCorrect: boolean;
  /** 정답 강조 표시 여부 (두 번 틀리고 아직 정답을 고르지 않았을 때) */
  highlightCorrect: boolean;
  /** [입력창에 넣기] 가능 여부 (정답을 골랐을 때만) */
  canInsert: boolean;
}

/** 🔘 보기 선택 상태. picked가 비어 있으면(처음·새 보기) 선택 없음 */
export function choiceState(options: ChoiceOptionLike[], picked: string[]): ChoiceState {
  const correct = options.find((o) => o.verdict === 'appropriate');
  const wrongCount = picked.filter((id) => options.find((o) => o.id === id)?.verdict !== 'appropriate').length;
  const pickedCorrect = correct ? picked.includes(correct.id) : false;
  return { wrongCount, pickedCorrect, highlightCorrect: !pickedCorrect && wrongCount >= 2, canInsert: pickedCorrect };
}

/**
 * 초급 상대역 발화를 다시 받았을 때 어느 쪽을 보여 줄지: 다시 받은 말이 문제가 같거나 적으면 다시 받은 말,
 * 더 많으면 처음 말 (다시 받는 것은 1회뿐이므로 둘 중 나은 쪽을 고름)
 */
export function pickBeginnerReply(first: string, firstIssues: string[], retry: string, retryIssues: string[]): { text: string; issues: string[] } {
  return retryIssues.length <= firstIssues.length ? { text: retry, issues: retryIssues } : { text: first, issues: firstIssues };
}

/** 표현 연습 대화의 난이도: 가장 최근의 "난이도: …" 시작 메시지(버튼·직접 입력)에서 읽음. 없으면 중급 */
export function expressionLevel(list: { role: string; content: string }[]): '초급' | '중급' | '고급' {
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i].role === 'user' ? list[i].content.match(/난이도\s*[:：]\s*(초급|중급|고급)/) : null;
    if (m) return m[1] as '초급' | '중급' | '고급';
  }
  return '중급';
}

/**
 * 롤플레이 입력창 안내 문구.
 * - 종료 상태: 종료 카드가 보이는 동안은 [대화 이어 가기]를, 피드백을 받아 카드가 사라진 뒤에는 화면에 남은 [장면 변경]을 안내
 * - 그 밖에는 상대역에게 할 말을 입력하라는 기본 안내
 */
export function roleplayInputPlaceholder(s: { ended: boolean; feedbackRequested: boolean; counterpart: string }): string {
  if (s.ended && s.feedbackRequested) return '피드백을 받았어요. 다시 하려면 [장면 변경]을 누르세요.';
  if (s.ended) return '대화가 끝났어요. 이어 가려면 [대화 이어 가기]를 누르세요.';
  return `${s.counterpart}에게 할 말을 입력하세요... (Enter 전송, Shift+Enter 줄바꿈)`;
}
