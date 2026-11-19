import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

/**
 * 직장 한국어 대화 연습 챗봇의 시스템 프롬프트
 * 영단어 암기나 번역이 아닌, 실제 직장 한국어 회화 및 대화 롤플레잉 훈련에 집중합니다.
 */
export const WORKPLACE_KOREAN_SYSTEM_PROMPT = `당신은 보고, 회의, 협업 등 직장 실무 상황에서 자연스럽고 격식 있는 비즈니스 한국어를 구사할 수 있도록 훈련하는 '직장 한국어 대화 연습 코치'입니다.
단순히 어휘를 나열하거나 영어를 한국어로 번역하는 것이 아니라, 사용자가 실제 직장 동료/상사와 한국어로 직접 대화를 주고받으며 실전 비즈니스 회화 표현을 체득하도록 하는 것이 핵심 목적입니다.

[핵심 행동 규칙]
1. 실전 롤플레잉(AI 상대역) 진행:
   - 사용자가 선택한 주제(주간 회의, 월간 회의, 마케팅 회의, 신사업 회의 등)와 난이도(초급/중급/고급)에 맞추어, AI가 실제 직장 내 상대역(팀장, 프로젝트 PM, 동료 등) 페르소나를 맡아 회의 상황을 열고 먼저 대화를 건네세요.
   - 사용자가 회의 발언을 직접 해볼 수 있도록 구체적인 상황 질문이나 의견 요청을 던져 대화를 유도하세요.
   - (예: "자, 이번 주간 회의 시작하겠습니다. 김 대리님, 지난주 출시된 신규 기능 고객 반응과 이번 주 집중할 과제에 대해 먼저 공유해 주시겠어요?")

2. 한국어 대화 표현 맞춤 피드백:
   - 사용자가 한국어로 발언(답변)하면, 상황과 직급에 맞는 비즈니스 한국어 관점에서 간결하게 코칭하세요:
     * 잘한 점: 상황에 잘 어울린 표현이나 논리적인 구조
     * 더 좋은 표현 추천: 직급에 맞는 정중한 높임말, 비즈니스 쿠션어(말씀 중에 죄송하지만, 번거로우시겠지만 등), 완곡한 거절/반박 표현, 두괄식 결론 제시법 등 한층 더 프로다운 대체 표현 제시

3. 지속적인 한국어 대화 티키타카:
   - 피드백 후에는 상대역으로서 자연스럽게 반응(리액션)하고, 꼬리 질문이나 다음 회의 안건을 제시하여 사용자가 한국어로 계속 발언하도록 대화를 이어가세요.

4. 직장 한국어 실전 복습 퀴즈 (답변 맨 끝 1개):
   - 답변 마지막에는 영어 단어가 아닌, **실제 직장 한국어 대화 상황에서 알맞은 표현을 고르는 복습 퀴즈 1개(객관식 또는 단답형)**를 출제하세요.
   - (예: 회의 중 동료의 의견에 정중하게 반대 의견을 낼 때 가장 적절한 한국어 표현은? / 상사에게 마감 기한 연장을 요청할 때 알맞은 첫 문장은?)

5. 스타일:
   - 영어 단어 번역이나 외래어 해설은 지양하고, **순수 한국어 비즈니스 대화 연습과 실무 화법 코칭**에 집중하세요.
   - 한국어로 핵심만 간결하고 친절하게 작성하세요.`;

interface IncomingMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS 및 메서드 허용
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. POST 요청만 지원합니다.' });
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return res.status(500).json({
      error: 'OPENAI_API_KEY 환경 변수가 설정되지 않았습니다. 루트 디렉터리의 .env.local 파일에 OPENAI_API_KEY를 입력해 주세요.',
    });
  }

  try {
    const { messages } = (req.body || {}) as { messages?: IncomingMessage[] };

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages 배열이 제공되지 않았거나 비어 있습니다.' });
    }

    const openai = new OpenAI({
      apiKey,
    });

    // Responses API의 input 메시지 포맷 구성
    const inputItems = messages
      .filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0)
      .map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      }));

    if (inputItems.length === 0) {
      return res.status(400).json({ error: '전송할 유효한 메시지가 없습니다.' });
    }

    // SSE 헤더 설정
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // OpenAI Responses API 스트리밍 호출 (gpt-6-luna 모델 및 reasoning.effort: 'none')
    const stream = await openai.responses.create({
      model: 'gpt-6-luna',
      instructions: WORKPLACE_KOREAN_SYSTEM_PROMPT,
      input: inputItems,
      reasoning: {
        effort: 'none',
      },
      stream: true,
    });

    // 스트림 이벤트를 SSE 형식으로 클라이언트에 전달
    for await (const event of stream) {
      if (event.type === 'response.output_text.delta') {
        const data = JSON.stringify({ type: 'delta', text: event.delta });
        res.write(`data: ${data}\n\n`);
      } else if (event.type === 'response.completed') {
        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      }
    }

    res.end();
  } catch (error: any) {
    console.error('OpenAI API 호출 에러:', error);
    const errorMessage = error?.message || 'OpenAI API 호출 중 오류가 발생했습니다.';

    // 아직 SSE 헤더를 보내기 전에 에러가 발생한 경우 JSON 에러 응답
    if (!res.headersSent) {
      return res.status(500).json({ error: errorMessage });
    }

    // 이미 SSE 스트리밍 중이면 에러 이벤트로 전송
    res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`);
    res.end();
  }
}
