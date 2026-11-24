/**
 * 개발 전용 가짜 응답 (?mock=1). API를 호출하지 않고 화면 흐름만 확인할 때 씀.
 * src/api/chat.ts가 import.meta.env.DEV일 때만 동적으로 불러오므로 배포 빌드에는 들어가지 않음.
 * 내용은 형식 확인용 중립 예시이며 학습 내용으로 쓰지 않음.
 */
import type { ChatMessage, StreamChatOptions } from './chat';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function lastUser(messages: ChatMessage[]): string {
  return [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
}

const INTRO = `1단계: 표현 소개 (세트 1 · 여행사)
1. 손님에게 메일을 보냈어요.
- 번역: I sent an email to the customer.
- 사용 장면: 팀장님에게 한 일을 말할 때
- 문형: V-았/었어요 [Y2-9·추정]
  · 기능: 이미 한 일을 말해요.
    Talks about something you already did.
  · 만들기: 보내다 → 보냈어요
  · 더 보기: 아침에 전화했어요.
2. 오늘 끝낼 수 있어요.
- 번역: I can finish it today.
- 사용 장면: 팀장님이 일이 언제 끝나는지 물을 때
- 문형: V-(으)ㄹ 수 있다
  · 기능: 할 수 있다고 말해요.
    Says you are able to do something.
  · 만들기: 끝내다 → 끝낼 수 있어요
  · 더 보기: 내일 보낼 수 있어요.
3. 지금 보고할까요?
- 번역: Shall I report now?
- 사용 장면: 팀장님에게 보고할 때를 물을 때
- 문형: V-을까요?
  · 기능: 상대의 생각을 물어요.
    Asks what the other person thinks.
  · 만들기: 보고하다 → 보고할까요?
  · 더 보기: 오후에 전화할까요?

"퀴즈 시작" → 지금까지 배운 표현으로 퀴즈 풀기 (Take a quiz on what you've learned)
"다른 표현" → 같은 주제의 새 표현 3개 더 보기 (See 3 more expressions)`;

const QUIZ = `복습 퀴즈 (Review Quiz)
Q. 다음 빈칸에 들어갈 알맞은 표현을 입력해 보세요.
   (Fill in the blank with the correct expression.)
오늘 ____.
힌트: Telling your manager you are able to finish.
답을 입력해 보세요. (Type your answer.)`;

const GRADE = `결과: 🟡 부분 정답
Partly correct
내 답: 끝내요
My answer: 끝내요
목표 표현: 끝낼 수 있어요
Target: 끝낼 수 있어요
다음 안내: "퀴즈 시작" 또는 "다른 표현"을 입력해 주세요.
Next: Type "퀴즈 시작" or "다른 표현".
[[NOTES]]
[{"scene":"보고 표현 연습","counterpart":"팀장님","original":"끝내요","corrected":"끝낼 수 있어요","category":"어휘·문법","reason":"할 수 있다는 뜻을 분명히 말해요."}]
[[/NOTES]]`;

const FEEDBACK = `## 롤플레이 피드백
**장면:** 예시 장면 · **상대:** 예시 상대
### 잘한 점
- 결론을 먼저 말했어요.
### 다시 생각해 볼 표현
1. 내가 한 말: "문제 있어요."
   더 알맞은 표현: "문제가 하나 있어요."
   이유: [보고 순서] — 문제의 수를 먼저 말하면 듣는 사람이 준비할 수 있어요.
### 말하기 순서 점검
- 대책이 빠졌어요.
### 다음에 써 볼 한 문장
- 내일 다시 알아봐요.
[[NOTES]]
[{"scene":"예시 장면","counterpart":"예시 상대","original":"문제 있어요.","corrected":"문제가 하나 있어요.","category":"보고 순서","reason":"수를 먼저 말해요."}]
[[/NOTES]]`;

function supportJson(type: string, replyTo: string): string {
  const meta = { replyTo, intent: '언제 할지 대답하기', intent_en: 'Say when' };
  const frame = { template: '{{1}}에 보내요.', blanks: [{ id: 1, hint: '요일', hint_en: 'day' }] };
  const options = [
    { id: 'A', text: '금요일에 보내요.', verdict: 'appropriate', reason: '날짜를 분명히 말했어요.', reason_en: 'You gave a clear day.' },
    { id: 'B', text: '보내요. 금요일에요.', verdict: 'partial', reason: '날짜를 늦게 말했어요.', reason_en: 'The day comes late.' },
    { id: 'C', text: '금요일에 보내.', verdict: 'inappropriate', reason: '반말이라 무례해요.', reason_en: 'Casual speech sounds rude.' },
  ];
  const body: Record<string, unknown> =
    type === 'hint' ? { steps: ['대답: 언제 하는지', '이유: 한 가지'], steps_en: ['Answer: when', 'Reason: one'] }
    : type === 'frame' ? frame
    : type === 'choices' ? { options }
    : type === 'model' ? { text: '금요일에 보내요.', text_en: 'I will send it on Friday.', tip: '날짜를 먼저 말했어요.', tip_en: 'You said the day first.' }
    : { frame, choices: { options } };
  return `[[SUPPORT]]${JSON.stringify({ type, ...meta, ...body })}[[/SUPPORT]]`;
}

function reply(messages: ChatMessage[], options?: StreamChatOptions): string {
  const mode = options?.mode ?? 'expression';
  const last = lastUser(messages);
  if (mode === 'roleplay_support') return supportJson(options?.supportType ?? 'hint', messages[messages.length - 1]?.content ?? '');
  if (mode === 'roleplay') return last.startsWith('[피드백 요청]') ? FEEDBACK : '그래요? 그럼 언제 돼요?';
  if (mode === 'review') return '결과: ✅ 정답(다른 적절한 표현)\n내 답: …\n모범 표현: …\n판단 근거:\n- 대상·높임: 알맞아요.\n[[RESULT]]{"verdict":"alternative","correct":true}[[/RESULT]]';
  if (mode === 'email') return '## 첨삭 결과\n### 한눈에 보기\n- 높임법: ✅ — 알맞아요.\n### 고칠 부분 (최대 5개, 중요한 순서)\n1. 원문: "확인하세요"\n   고친 표현: "확인 부탁드립니다"\n   이유: [완곡 표현] — 요청을 부드럽게 해요.\n### 고친 예시\n**확인 부탁드립니다.**\n[[NOTES]][{"scene":"이메일 첨삭","counterpart":"동료","original":"확인하세요","corrected":"확인 부탁드립니다","category":"완곡 표현","reason":"부드럽게 요청"}][[/NOTES]]';
  if (/^퀴즈\s*시작/.test(last)) return QUIZ;
  if (/^다른 (표현|문형)|^표현 더 보기/.test(last)) return INTRO.replace('세트 1 · 여행사', '세트 2 · 화장품 회사');
  if (/주제\s*:/.test(last)) return INTRO;
  return GRADE;
}

export async function mockStreamChat(messages: ChatMessage[], onDelta: (chunk: string) => void, options?: StreamChatOptions): Promise<string> {
  const text = reply(messages, options);
  // 스트리밍처럼 몇 글자씩 나눠 보냄 (메타 블록 마커가 중간에 잘리는 경우도 재현)
  for (let i = 0; i < text.length; i += 7) {
    await sleep(12);
    onDelta(text.slice(i, i + 7));
  }
  return text;
}
