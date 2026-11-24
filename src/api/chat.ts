export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatApiResponse {
  message?: string;
  error?: string;
}

export type ChatMode = 'expression' | 'roleplay' | 'email' | 'review' | 'roleplay_support';
export type RoleplayLevel = '초급' | '중급' | '고급';
export type SupportType = 'hint' | 'frame' | 'choices' | 'model' | 'starter';

export interface StreamChatOptions {
  mode?: ChatMode;
  sceneId?: string;
  /** roleplay_support 전용 */
  level?: RoleplayLevel;
  /** roleplay_support 전용 */
  supportType?: SupportType;
  /** roleplay_support choices 전용: 대체 경로에서 먼저 받은 문장 틀 (정답 보기를 이 틀에 맞추게 함) */
  frameTemplate?: string;
  /** roleplay 초급 전용: 상대역 말이 초급 기준을 넘어 다시 받을 때 true */
  simplify?: boolean;
}

/** 서버 오류 응답. status로 429(한도 초과) 등을 구분할 수 있음 */
export class ChatApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ChatApiError';
    this.status = status;
  }
}

/** SSE 스트림에서 수신하는 개별 이벤트 타입 */
interface StreamEvent {
  type: 'delta' | 'done' | 'error';
  text?: string;
  error?: string;
}

/**
 * Vercel 서버리스 함수(/api/chat)로 사용자의 대화 기록을 전송하고
 * SSE 스트리밍으로 AI 응답을 실시간 수신합니다.
 *
 * @param messages - 대화 기록 목록
 * @param onDelta - 텍스트 조각이 수신될 때마다 호출되는 콜백
 * @param options - 모드('expression' | 'roleplay' | 'email' | 'review') 및 sceneId
 * @returns 완성된 전체 응답 텍스트
 */
export async function streamChatMessage(
  messages: ChatMessage[],
  onDelta: (chunk: string) => void,
  options?: StreamChatOptions,
): Promise<string> {
  // 개발 전용 가짜 응답 모드 (?mock=1): API를 호출하지 않고 화면 흐름을 확인. 배포 빌드에서는 이 분기가 제거됨
  if (import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('mock') === '1') {
    const { mockStreamChat } = await import('./mockChat');
    return mockStreamChat(messages, onDelta, options);
  }

  const payload: {
    messages: ChatMessage[];
    mode?: ChatMode;
    sceneId?: string;
    level?: RoleplayLevel;
    supportType?: SupportType;
    frameTemplate?: string;
    simplify?: boolean;
  } = {
    messages,
    ...(options?.mode ? { mode: options.mode } : {}),
    ...(options?.sceneId ? { sceneId: options.sceneId } : {}),
    ...(options?.level ? { level: options.level } : {}),
    ...(options?.supportType ? { supportType: options.supportType } : {}),
    ...(options?.frameTemplate ? { frameTemplate: options.frameTemplate } : {}),
    ...(options?.simplify ? { simplify: true } : {}),
  };

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  // JSON 에러 응답 처리 (SSE 스트리밍 시작 전에 발생한 에러)
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data: ChatApiResponse = await response.json().catch(() => ({}));
    throw new ChatApiError(data.error || `서버 요청 실패 (상태 코드: ${response.status})`, response.status);
  }

  if (!response.ok) {
    throw new ChatApiError(`서버 요청 실패 (상태 코드: ${response.status})`, response.status);
  }

  if (!response.body) {
    throw new Error('서버로부터 스트림 응답을 받지 못했습니다.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // SSE 형식 파싱: "data: {...}\n\n" 단위로 처리
    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;

      const jsonStr = trimmed.slice('data: '.length);
      try {
        const event: StreamEvent = JSON.parse(jsonStr);

        if (event.type === 'delta' && event.text) {
          fullText += event.text;
          onDelta(event.text);
        } else if (event.type === 'error') {
          throw new Error(event.error || 'OpenAI API 호출 중 오류가 발생했습니다.');
        }
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message !== jsonStr) {
          throw parseError;
        }
      }
    }
  }

  if (!fullText) {
    throw new Error('서버로부터 유효한 응답을 받지 못했습니다.');
  }

  return fullText;
}
