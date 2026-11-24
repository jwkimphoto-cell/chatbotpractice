import type { VercelRequest, VercelResponse } from '@vercel/node';
import OpenAI from 'openai';
import {
  WORKPLACE_KOREAN_SYSTEM_PROMPT,
  buildRoleplayPrompt,
  EMAIL_COACH_PROMPT,
  REVIEW_GRADER_PROMPT,
  buildRoleplaySupportInstructions,
  type RoleplayLevel,
  type SupportType,
} from './_lib/prompts.js';
import { SERVER_SCENES } from './_lib/scenes.js';
import {
  buildNextSetInstruction,
  buildStartInstruction,
  chooseNextPatterns,
  findExpressionContext,
  isStartRequest,
  parseMoreRequest,
} from './_lib/patterns.js';

export { WORKPLACE_KOREAN_SYSTEM_PROMPT };

interface IncomingMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const ALLOWED_MODES = ['expression', 'roleplay', 'email', 'review', 'roleplay_support'] as const;
type ChatMode = (typeof ALLOWED_MODES)[number];

/** 롤플레이 도움 사다리 화이트리스트 */
const ALLOWED_LEVELS: readonly RoleplayLevel[] = ['초급', '중급', '고급'];
const ALLOWED_SUPPORT_TYPES: readonly SupportType[] = ['hint', 'frame', 'choices', 'model', 'starter'];

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
    const { mode: rawMode, sceneId, messages, level, supportType } = (req.body || {}) as {
      mode?: string;
      sceneId?: string;
      messages?: IncomingMessage[];
      level?: string;
      supportType?: string;
    };

    // 1. 모드 검사 (기본값: 'expression')
    const mode: ChatMode = (rawMode || 'expression') as ChatMode;
    if (!ALLOWED_MODES.includes(mode)) {
      return res.status(400).json({ error: '지원하지 않는 모드입니다.' });
    }

    // 2. 메시지 배열 및 개수 검증 (최대 40개)
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages 배열이 제공되지 않았거나 비어 있습니다.' });
    }

    if (messages.length > 40) {
      return res.status(400).json({ error: '메시지는 최대 40개까지 전송할 수 있습니다.' });
    }

    // 3. 개별 메시지 길이 검증 (최대 4,000자)
    for (const msg of messages) {
      if (msg && typeof msg.content === 'string' && msg.content.length > 4000) {
        return res.status(400).json({ error: '메시지 길이는 4,000자를 초과할 수 없습니다.' });
      }
    }

    // 4. 모드별 서버 전용 instructions 조립 (프롬프트 주입 방지)
    let instructions = '';
    if (mode === 'expression') {
      instructions = WORKPLACE_KOREAN_SYSTEM_PROMPT;

      // "다른 표현" 요청이면 서버가 문형 목록에서 다음 세트 문형 3개를 직접 골라 안내를 덧붙임.
      // 클라이언트 텍스트는 주제·난이도(고정 값 중 하나)와 이미 쓴 문형 판별에만 쓰고,
      // instructions에는 서버 목록의 문형 형태와 고정 문구만 들어감.
      const lastUser = [...messages]
        .reverse()
        .find((m) => m && m.role === 'user' && typeof m.content === 'string');
      const usedPatterns = lastUser ? parseMoreRequest(lastUser.content) : null;
      const ctx = findExpressionContext(messages);
      if (ctx && usedPatterns) {
        instructions += buildNextSetInstruction(ctx, chooseNextPatterns(ctx, usedPatterns));
      } else if (ctx && lastUser && isStartRequest(lastUser.content)) {
        // 첫 세트: 그 주제·난이도 목록의 예시 문장을 그대로 쓰지 않도록 안내 (서버 데이터만)
        instructions += buildStartInstruction(ctx);
      }
    } else if (mode === 'roleplay') {
      // Object.hasOwn: 'toString', '__proto__' 같은 프로토타입 키가 통과하지 않도록 검사
      if (typeof sceneId !== 'string' || !Object.hasOwn(SERVER_SCENES, sceneId)) {
        return res.status(400).json({ error: '유효한 장면(sceneId)을 선택해 주세요.' });
      }
      instructions = buildRoleplayPrompt(SERVER_SCENES[sceneId]);
    } else if (mode === 'roleplay_support') {
      // 도움 사다리: level·supportType·sceneId는 화이트리스트 값만 허용, instructions는 서버 데이터로만 조립
      if (typeof level !== 'string' || !(ALLOWED_LEVELS as readonly string[]).includes(level)) {
        return res.status(400).json({ error: '난이도(level)는 초급, 중급, 고급 중 하나여야 합니다.' });
      }
      if (typeof supportType !== 'string' || !(ALLOWED_SUPPORT_TYPES as readonly string[]).includes(supportType)) {
        return res.status(400).json({ error: '지원하지 않는 도움 종류(supportType)입니다.' });
      }
      if (supportType === 'starter' && level !== '초급') {
        return res.status(400).json({ error: 'starter 도움은 초급에서만 쓸 수 있습니다.' });
      }
      if (typeof sceneId !== 'string' || !Object.hasOwn(SERVER_SCENES, sceneId)) {
        return res.status(400).json({ error: '유효한 장면(sceneId)을 선택해 주세요.' });
      }
      const last = messages[messages.length - 1];
      if (!last || last.role !== 'assistant') {
        return res.status(400).json({ error: '도움은 상대역의 말 다음에만 요청할 수 있습니다. 마지막 메시지가 상대역(assistant)의 말이어야 합니다.' });
      }
      instructions = buildRoleplaySupportInstructions(
        SERVER_SCENES[sceneId],
        level as RoleplayLevel,
        supportType as SupportType,
      );
    } else if (mode === 'email') {
      instructions = EMAIL_COACH_PROMPT;
    } else if (mode === 'review') {
      instructions = REVIEW_GRADER_PROMPT;
    }

    // 5. Responses API input 구성
    const inputItems = messages
      .filter((m) => m && typeof m.content === 'string' && m.content.trim().length > 0)
      .map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      }));

    if (inputItems.length === 0) {
      return res.status(400).json({ error: '전송할 유효한 메시지가 없습니다.' });
    }

    // 도움 사다리: 대화 기록 뒤에 서버가 만든 요청 메시지 하나를 덧붙임.
    // 종류·난이도는 화이트리스트 값, 상대역의 말·학습자 발화는 서버가 messages에서 직접 뽑음 (input에만 넣고 instructions에는 넣지 않음)
    if (mode === 'roleplay_support') {
      const lastAssistant = messages[messages.length - 1].content.trim();
      const learnerSaid = messages
        .filter((m) => m && m.role === 'user' && typeof m.content === 'string')
        .map((m) => m.content.replace(/^\[난이도:[^\]]*\]\s*/, '').trim())
        .filter((t) => t.length > 0);
      inputItems.push({
        role: 'user' as const,
        content: [
          `[도움 요청] 종류: ${supportType} / 난이도: ${level}`,
          `[지금 대답할 상대역의 말] ${lastAssistant}`,
          `[학습자가 이미 말한 내용] ${learnerSaid.length > 0 ? learnerSaid.join(' / ') : '없음'}`,
        ].join('\n'),
      });
    }

    const openai = new OpenAI({
      apiKey,
    });

    // SSE 헤더 설정
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // OpenAI Responses API 스트리밍 호출 (gpt-6-luna 모델 및 reasoning.effort: 'none')
    const stream = await openai.responses.create({
      model: 'gpt-6-luna',
      instructions,
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
      // OpenAI 한도 초과(429)는 그대로 429로 전달해 화면이 "잠시 후 다시 시도" 안내를 보여 줄 수 있게 함
      const status = error?.status === 429 ? 429 : 500;
      return res.status(status).json({ error: errorMessage });
    }

    // 이미 SSE 스트리밍 중이면 에러 이벤트로 전송
    res.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`);
    res.end();
  }
}
