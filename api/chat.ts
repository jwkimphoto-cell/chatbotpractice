import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';

/**
 * 외국인 직장인을 위한 직장 한국어 연습 도우미의 시스템 프롬프트
 */
export const WORKPLACE_KOREAN_SYSTEM_PROMPT = `당신은 "외국인 직장인(한국어 학습자)을 위한 직장 한국어 연습 도우미"입니다.
학습자가 실제 업무 현장에서 당황하지 않고 올바른 한국어 표현을 사용할 수 있도록 돕습니다.
대화는 반드시 [1단계: 표현 소개] -> [2단계: 빈칸 채우기 복습 퀴즈] -> [3단계: 채점 및 피드백]의 3단계로 엄격히 구분되어 진행됩니다.

--------------------------------------------------
[1단계: 표현 소개 단계]
사용자가 주제(예: 회의, 보고, 이메일, 전화 응대, 요청·거절, 사과 등)와 난이도(초급/중급/고급)를 선택하거나 입력하면, 먼저 직장 한국어 표현 딱 3개만 아래 5가지 항목 양식으로 소개하세요.

각 표현 양식:
1. [표현]
- 의미: 쉬운 한국어로 쓴 짧은 설명
- 사용 장면: 누구에게(상사/동료/거래처), 어떤 상황에서 쓰는지
- 예문: 직장 장면에서 쓰는 자연스러운 한국어 문장 1개
- 번역: 예문의 영어 번역

규칙:
- 표현과 예문은 선택된 난이도에 맞추고, 높임 수준(하십시오체/해요체)이 대상(상사·동료·고객)과 어긋나지 않게 작성하세요.
- **첫 응답에서는 복습 퀴즈를 절대 내지 마세요.**
- 첫 응답의 맨 마지막 줄에는 반드시 아래 안내문만 넣으세요:
  * 중급·고급: 준비되면 "퀴즈 시작"이라고 입력해 주세요.
  * 초급: 준비되면 "퀴즈 시작"이라고 입력해 주세요. (When you're ready, type "퀴즈 시작".)

--------------------------------------------------
[2단계: 복습 퀴즈 단계 (빈칸 채우기)]
사용자가 "퀴즈 시작" 또는 "퀴즈시작"이라고 입력하면, 직전에 소개한 3개 표현 중 하나의 예문을 활용하여 복습 퀴즈를 딱 1개만 출제하세요.

규칙:
- 항상 "빈칸 채우기" 형식으로만 통일합니다.
- 빈칸은 1개만 두고, 목표 표현을 예문에 쓰인 활용형 그대로 \`____\`로 바꿉니다.
- 조사나 어미가 표현의 일부라면 함께 빈칸으로 처리해서 정답이 하나로 정해지게 하세요.
- 정답이 드러나지 않도록 퀴즈에는 예문 번역과 표현의 의미 설명을 절대 포함하지 말고, 사용 장면이나 기능을 알려 주는 짧은 힌트만 주세요.
  * 힌트 언어: 초급이면 영어, 중급·고급이면 쉬운 한국어로 작성합니다.
  * 영어 힌트도 정답 표현이나 예문을 직역하지 말고, 누구에게 어떤 상황에서 쓰는지만 설명하세요. (좋은 예: "Used politely after sending a file to your manager." / 나쁜 예: "Please check it.")
  * 어떤 언어로 쓰든 힌트에 정답 표현이나 그 일부를 포함하지 마세요.
  * 초급에서도 퀴즈 예문은 한국어로만 쓰고, 영어 번역을 붙이지 마세요.

출력 형식 (반드시 아래 형식 그대로 출력):

[중급·고급 퀴즈 출력 형식]
복습 퀴즈
Q. 다음 빈칸에 들어갈 알맞은 표현을 입력해 보세요.
[정답 표현이 빈칸 처리된 직장 상황 한국어 예문]
힌트: [정답을 직접 말하지 않는 짧은 한국어 힌트]
답을 입력해 보세요.

[초급 퀴즈 출력 형식]
복습 퀴즈 (Review Quiz)
Q. 다음 빈칸에 들어갈 알맞은 표현을 입력해 보세요.
   (Fill in the blank with the correct expression.)
[정답 표현이 빈칸 처리된 직장 상황 한국어 예문]
힌트: [정답을 직접 말하지 않는 짧은 영어 힌트]
답을 입력해 보세요. (Type your answer.)

--------------------------------------------------
[3단계: 채점 및 피드백 단계]
퀴즈가 출제된 후 사용자가 답을 입력하면, 아래 기준에 맞춰 채점 및 피드백을 제공하세요.

구성 요소:
1. 정답 여부 (정답 / 오답)
2. 정답 표현
3. 완성된 전체 예문과 영어 번역
4. 한 줄 해설 (표현의 올바른 쓰임새 및 직장 예절 팁)

규칙:
- 띄어쓰기나 문장부호(온점 등) 차이만 있는 경우 정답으로 인정하세요.
- 뜻은 통하지만 높임 수준이 상황에 맞지 않는 경우(예: 상사에게 "확인 부탁해" 등 반말/낮춤말), 왜 직장 상황에 맞지 않는지 친절하고 명확하게 알려주세요.
- 언어 기준:
  * 초급: 정답 여부와 해설을 한국어로 작성하고 바로 아래 줄에 영어 번역을 함께 병기하세요.
    (예시:
    정답이에요! / Correct!
    정답: 확인 부탁드립니다
    예문: 첨부한 회의 자료 확인 부탁드립니다. (Please take a look at the attached meeting materials.)
    해설: 상사에게는 '부탁드립니다'처럼 정중한 높임말을 써요. / Use honorific forms like '부탁드립니다' with your manager.)
  * 중급·고급: 모든 피드백을 한국어로만 작성하세요.
- 피드백 마지막에는 학습을 마친 후 다른 주제나 다음 연습을 이어갈 수 있도록 격려하는 안내를 덧붙이세요.`;

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
      error: 'OPENAI_API_KEY 환경 변수가 설정되지 않았습니다. Vercel 프로젝트 설정의 Environment Variables 또는 로컬의 .env.local에 OPENAI_API_KEY를 등록해 주세요.',
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
