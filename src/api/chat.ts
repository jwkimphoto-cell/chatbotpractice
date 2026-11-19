export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatApiResponse {
  message?: string;
  error?: string;
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
 * @param onDelta - 텍스트 조각이 수신될 때마다 호출되는 콜백
 * @returns 완성된 전체 응답 텍스트
 */
export async function streamChatMessage(
  messages: ChatMessage[],
  onDelta: (chunk: string) => void,
): Promise<string> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
  });

  // JSON 에러 응답 처리 (SSE 스트리밍 시작 전에 발생한 에러)
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data: ChatApiResponse = await response.json().catch(() => ({}));
    throw new Error(data.error || `서버 요청 실패 (상태 코드: ${response.status})`);
  }

  if (!response.ok) {
    throw new Error(`서버 요청 실패 (상태 코드: ${response.status})`);
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
    // 마지막 조각은 아직 완전하지 않을 수 있으므로 버퍼에 보관
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
        // 'done' 이벤트는 스트림 종료를 의미하며, reader.read()의 done으로 자연 종료됨
      } catch (parseError) {
        // JSON 파싱 실패한 경우, 이미 throw된 Error가 아니면 무시
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
