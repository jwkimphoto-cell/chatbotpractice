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
  const inChat = s.stage === 'chat' && !s.feedbackRequested;
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
