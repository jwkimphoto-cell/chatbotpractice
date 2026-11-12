export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatApiResponse {
  message?: string;
  error?: string;
}

/**
 * Vercel 서버리스 함수(/api/chat)로 사용자의 대화 기록을 전송하고 AI 응답을 받습니다.
 * 프런트엔드 코드에는 OpenAI API Key가 일체 노출되지 않습니다.
 */
export async function sendChatMessage(messages: ChatMessage[]): Promise<string> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
  });

  const data: ChatApiResponse = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `서버 요청 실패 (상태 코드: ${response.status})`);
  }

  if (!data.message) {
    throw new Error('서버로부터 유효한 응답을 받지 못했습니다.');
  }

  return data.message;
}

