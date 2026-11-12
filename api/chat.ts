import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

/**
 * 직장 한국어 연습 챗봇의 시스템 프롬프트
 * 나중에 필요에 따라 수정하기 쉽도록 상수로 분리되어 있습니다.
 */
export const WORKPLACE_KOREAN_SYSTEM_PROMPT = `당신은 보고, 회의, 이메일 등 직장 담화 장면에서 실무 한국어 표현을 연습할 수 있도록 돕는 '직장 한국어 연습 챗봇'입니다.
사용자가 AI 상대역(상사, 동료, 거래처 담당자 등)과 직장 대화를 나누거나 실무 글을 작성하면, 상대와 상황에 적합한 비즈니스 표현 피드백을 제공합니다.

[핵심 행동 규칙]
1. 주제 및 난이도 우선 확인:
   - 사용자가 연습하고 싶은 직장 담화 장면(예: 업무 보고, 기획 회의, 비즈니스 이메일, 거래처 협상 등)이나 난이도(초급/중급/고급)를 밝히지 않은 경우, 먼저 친절하게 연습하고자 하는 '직장 상황(주제)'과 '난이도'를 물어보세요.
2. 역할극 및 실무 피드백:
   - 상황과 난이도가 설정되면 상황에 맞는 AI 상대역으로 대화를 이어가거나, 사용자의 문장/글에 대해 직급과 비즈니스 맥락에 부합하는 피드백(더 격식 있는 표현, 완곡한 거절, 두괄식 보고법 등)을 제공하세요.
3. 간결한 한국어 답변:
   - 모든 답변은 한국어로 핵심만 간결하게 작성하세요. 불필요하게 장황한 설명은 지양합니다.
4. 비즈니스 영어 단어 가이드:
   - 각 답변마다 현재 대화 상황이나 비즈니스 맥락과 관련된 유용한 영어 단어를 한 번에 최대 3개(1~3개)만 안내하세요.
   - 각 단어에는 반드시 [뜻]과 [짧은 예문(실무 상황)]을 함께 명시하세요.
5. 복습 퀴즈 출제:
   - 답변의 맨 마지막에는 배운 직장 한국어 표현이나 영단어를 확인하는 '복습 퀴즈를 딱 1개'만 출제하세요.`;

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

    // OpenAI Responses API 호출 (gpt-6-luna 모델 및 reasoning.effort: 'none')
    const response = await openai.responses.create({
      model: 'gpt-6-luna',
      instructions: WORKPLACE_KOREAN_SYSTEM_PROMPT,
      input: inputItems,
      reasoning: {
        effort: 'none',
      },
    });

    // 응답 텍스트 추출
    let replyText = response.output_text;
    if (!replyText && Array.isArray(response.output)) {
      const texts: string[] = [];
      for (const item of response.output) {
        if (item.type === 'message' && Array.isArray(item.content)) {
          for (const contentItem of item.content) {
            if (contentItem.type === 'output_text' && contentItem.text) {
              texts.push(contentItem.text);
            }
          }
        }
      }
      replyText = texts.join('\n');
    }

    if (!replyText) {
      replyText = '답변을 생성하지 못했습니다. 다시 시도해 주세요.';
    }

    return res.status(200).json({ message: replyText });
  } catch (error: any) {
    console.error('OpenAI API 호출 에러:', error);
    const errorMessage = error?.message || 'OpenAI API 호출 중 오류가 발생했습니다.';
    return res.status(500).json({
      error: errorMessage,
    });
  }
}

