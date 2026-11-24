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
