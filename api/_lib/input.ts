/**
 * Responses API input 조립 도우미 (서버 전용). 서버가 만든 고정 안내만 덧붙이며 클라이언트 텍스트를 instructions에 넣지 않음.
 */

export interface InputItem {
  role: 'user' | 'assistant';
  content: string;
}

/** [대화 이어 가기] 뒤 첫 요청에 덧붙이는 서버 안내 (input에만 넣음) */
export const RESUME_NOTE = '[계속] 학습자가 대화를 이어 가기로 함. 새 화제를 자연스럽게 하나 제시';

/**
 * 롤플레이 [대화 이어 가기]: 마지막 학습자 발화 바로 앞에 서버 안내를 넣음
 * (마지막 입력은 학습자의 말로 두어, 상대역이 학습자의 말에 대답하면서 새 화제를 꺼내게 함)
 */
export function withResumeNote(items: InputItem[]): InputItem[] {
  const lastUser = items.map((m) => m.role).lastIndexOf('user');
  const note: InputItem = { role: 'user', content: RESUME_NOTE };
  if (lastUser === -1) return [...items, note];
  return [...items.slice(0, lastUser), note, ...items.slice(lastUser)];
}
