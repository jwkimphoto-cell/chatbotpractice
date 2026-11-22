/**
 * 표현 연습 주제·난이도별 문형 목록 (서버 전용 데이터, 유일한 원본)
 * - WORKPLACE_KOREAN_SYSTEM_PROMPT의 [주제·난이도별 문형 목록] 글은 이 데이터로 만든다(patternListText).
 * - '다른 표현' 요청 때 서버가 아직 안 쓴 문형을 고르는 데도 쓴다(chooseNextPatterns).
 * - docs/level-guide.md 3장 목록과 내용이 같아야 한다.
 */

export type Topic = '보고' | '이메일' | '회의';
export type Level = '초급' | '중급' | '고급';

const LEVELS: Level[] = ['초급', '중급', '고급'];

export interface PatternItem {
  /** 문형 형태 (예: V-을까요?) */
  form: string;
  /** 출처 표시 (예: Y1-10, Y2-9·추정, 보충, 격식) — 학습자 화면에는 보이지 않음 */
  tag: string;
  /** 대표 문장 예시 (참고용, 그대로 복사하지 않음) */
  example: string;
}

export interface PatternGroup {
  topic: Topic;
  level: Level;
  items: PatternItem[];
}

export const PATTERN_GROUPS: PatternGroup[] = [
  {
    topic: "보고",
    level: "초급",
    items: [
      { form: "N이에요/예요", tag: "Y1-4", example: "이건 제 보고서예요." },
      { form: "V-아/어요", tag: "Y1-8", example: "지금 보고서를 써요." },
      { form: "N부터 N까지", tag: "Y1-12", example: "회의는 오후 두 시부터 세 시까지예요." },
      { form: "V-았/었어요", tag: "Y2-9·추정", example: "메일을 보냈어요." },
      { form: "V-ㅂ/습니다", tag: "Y2-1·추정", example: "보고서를 다 썼습니다." },
      { form: "V-고", tag: "Y2-4·추정", example: "자료를 만들고 메일을 보냈어요." },
      { form: "V-(으)ㄹ 수 있다", tag: "Y2-14·추정", example: "오늘 끝낼 수 있어요." },
      { form: "V-을까요?", tag: "Y1-10", example: "팀장님, 지금 보고할까요?" },
    ],
  },
  {
    topic: "이메일",
    level: "초급",
    items: [
      { form: "N입니다", tag: "Y2-1·추정", example: "안녕하세요. 영업팀 마이클입니다." },
      { form: "N하고 N", tag: "Y1-11", example: "사진하고 자료를 보내요." },
      { form: "V-아/어 주세요", tag: "Y2-3·추정", example: "내일까지 보내 주세요. (동료에게)" },
      { form: "V-고 싶다", tag: "Y1-13", example: "다음 주에 만나고 싶어요." },
      { form: "V-아서/어서(순서)", tag: "Y2-12·추정", example: "자료를 만들어서 보냈어요." },
      { form: "V-(으)ㄹ N", tag: "Y2-11·추정", example: "내일 보낼 자료예요." },
      { form: "N 동안", tag: "Y2-15·추정", example: "삼 일 동안 회사에 없어요." },
      { form: "V-았/었습니다", tag: "Y2-15·추정", example: "메일 잘 받았습니다." },
    ],
  },
  {
    topic: "회의",
    level: "초급",
    items: [
      { form: "V-을까요?", tag: "Y1-10", example: "회의를 시작할까요?" },
      { form: "N도", tag: "Y1-7", example: "저도 좋아요." },
      { form: "N에서", tag: "Y1-13", example: "회의는 3층 회의실에서 해요." },
      { form: "A/V-지만", tag: "Y2-5·추정", example: "좋지만 조금 비싸요." },
      { form: "N보다", tag: "Y2-10·추정", example: "이게 그것보다 싸요." },
      { form: "V-(으)ㅂ시다", tag: "Y2-7·추정", example: "다음 주에 다시 이야기합시다. (회의를 진행할 때)" },
      { form: "A/V-(으)니까", tag: "Y2-13·추정", example: "시간이 없으니까 빨리 시작해요." },
      { form: "V-아/어 주세요", tag: "Y2-3·추정", example: "다시 한번 말씀해 주세요." },
    ],
  },
  {
    topic: "보고",
    level: "중급",
    items: [
      { form: "V-고 있다", tag: "Y3-4", example: "지금 자료를 정리하고 있어요." },
      { form: "A/V-(으)ㄹ 것 같다", tag: "Y3-5", example: "오늘은 조금 늦을 것 같아요." },
      { form: "A/V-기 때문에", tag: "Y3-13", example: "자료가 많기 때문에 시간이 걸려요." },
      { form: "V-(으)ㄴ 후에", tag: "Y3-9", example: "회의가 끝난 후에 보고할게요." },
      { form: "V-기 전에", tag: "Y3-1", example: "퇴근하기 전에 보고서를 보낼게요." },
      { form: "V-(으)ㄹ게요", tag: "Y3-2", example: "제가 내일 다시 연락할게요." },
      { form: "V-겠습니다", tag: "Y3-9", example: "네, 바로 하겠습니다." },
      { form: "N밖에", tag: "Y3-6", example: "아직 반밖에 못 했어요." },
    ],
  },
  {
    topic: "이메일",
    level: "중급",
    items: [
      { form: "A/V-는데(배경)", tag: "Y3-2", example: "일정을 보냈는데 확인해 주세요." },
      { form: "V-(으)ㄹ게요", tag: "Y3-2", example: "내일 오전에 보내 드릴게요." },
      { form: "A/V-(으)면", tag: "Y3-6", example: "시간이 있으면 전화 주세요." },
      { form: "V-(으)려고 하다", tag: "Y3-4", example: "금요일에 회의를 하려고 해요." },
      { form: "V-(으)ㄹ 거예요(계획)", tag: "Y3-7", example: "다음 주에 출장을 갈 거예요." },
      { form: "V-(으)ㄴ 적이 있다", tag: "Y3-3", example: "작년에 한 번 만난 적이 있어요." },
      { form: "A/V-았/었으면 좋겠다", tag: "Y3-15", example: "내일까지 답장을 주셨으면 좋겠어요." },
      { form: "A-게", tag: "Y3-7", example: "보기 쉽게 정리했어요." },
    ],
  },
  {
    topic: "회의",
    level: "중급",
    items: [
      { form: "A/V-(으)ㄴ/는 것 같다", tag: "Y3-5", example: "그 생각이 좋은 것 같아요." },
      { form: "A/V-는데(대조)", tag: "Y3-15", example: "A안은 싼데 B안은 더 좋아요." },
      { form: "A/V-(으)면", tag: "Y3-6", example: "질문이 있으면 말씀해 주세요." },
      { form: "V-아/어 보다", tag: "Y3-8", example: "다른 방법도 생각해 볼까요?" },
      { form: "A/V-(으)ㄹ 때", tag: "Y3-10", example: "바쁠 때 전화해 주세요." },
      { form: "A/V-(으)ㄹ 거예요(추측)", tag: "Y3-13", example: "이 방법이 더 빠를 거예요." },
      { form: "N이나", tag: "Y3-12", example: "화요일이나 수요일에 만나요." },
      { form: "A/V-는군요", tag: "Y3-3", example: "아, 그렇군요." },
    ],
  },
  {
    topic: "보고",
    level: "고급",
    items: [
      { form: "V-기로 하다", tag: "Y4-12", example: "금요일까지 보고서를 내기로 했습니다." },
      { form: "A-아/어 보이다", tag: "Y4-9", example: "새 제품 반응이 좋아 보입니다." },
      { form: "A-아/어지다", tag: "Y4-2", example: "요즘 주문이 많아졌습니다." },
      { form: "V-아/어야 하다", tag: "Y4-4", example: "오늘 안에 이 일을 끝내야 합니다." },
      { form: "V-게 되다", tag: "보충", example: "다음 주부터 출장을 가게 되었습니다." },
      { form: "V-(으)ㄴ 지", tag: "Y4-1", example: "일을 시작한 지 한 달이 됐습니다." },
      { form: "A/V-아/어서 그런지", tag: "Y4-15", example: "날씨가 추워서 그런지 손님이 적습니다." },
      { form: "V-다가", tag: "Y4-7", example: "자료를 만들다가 질문이 생겼습니다." },
      { form: "보고드리겠습니다", tag: "격식", example: "오늘 회의 결과를 보고드리겠습니다." },
    ],
  },
  {
    topic: "이메일",
    level: "고급",
    items: [
      { form: "V-아/어도 되다", tag: "Y4-3", example: "자료를 내일 보내 드려도 될까요?" },
      { form: "V-(으)려면", tag: "Y4-4", example: "회의실을 쓰려면 미리 예약해야 합니다." },
      { form: "A/V-(으)ㄹ지 모르겠다", tag: "Y4-10", example: "이 일정이 괜찮으실지 모르겠습니다." },
      { form: "V-는지 알다/모르다", tag: "Y4-14", example: "회의가 몇 시에 끝나는지 알려 주세요." },
      { form: "A/V-나요?", tag: "Y4-5", example: "첨부 파일이 잘 열리나요?" },
      { form: "확인 부탁드립니다", tag: "격식", example: "첨부 파일 확인 부탁드립니다." },
      { form: "V-아/어 주시면 감사하겠습니다", tag: "격식", example: "내일까지 보내 주시면 감사하겠습니다." },
      { form: "A/V-아/어서 죄송합니다", tag: "보충", example: "답장이 늦어서 죄송합니다." },
    ],
  },
  {
    topic: "회의",
    level: "고급",
    items: [
      { form: "V-(으)ㄹ까 하다", tag: "Y4-11", example: "다음 회의는 화상으로 할까 합니다." },
      { form: "V-지 말고", tag: "Y4-11", example: "오늘 정하지 말고 다음 주에 다시 이야기해요." },
      { form: "A/V-기는 하지만", tag: "Y4-1", example: "좋은 생각이기는 하지만 비용이 걱정됩니다." },
      { form: "A/V-아/어도", tag: "Y4-15", example: "조금 비싸도 이 방법이 좋겠습니다." },
      { form: "V-(으)ㄹ지 V-(으)ㄹ지", tag: "Y4-13", example: "화요일에 할지 수요일에 할지 정해 주세요." },
      { form: "V-(으)면 안 되다", tag: "Y4-5", example: "회의 중에는 전화하면 안 됩니다." },
      { form: "N만큼", tag: "Y4-14", example: "작년만큼 결과가 좋습니다." },
      { form: "말씀드리고 싶은 게 있습니다", tag: "격식", example: "한 가지 말씀드리고 싶은 게 있습니다." },
    ],
  },
];
/**
 * 난이도별 직장 어휘 목록 (유일한 원본). 프롬프트의 어휘 줄과 서버 어휘 안내가 이 데이터를 씀.
 * 위 단계 목록은 아래 단계 어휘를 포함하는 것으로 본다(중급 = 초급 + 중급 목록).
 */
export const VOCAB: Record<Level, string[]> = {
  초급: ["회사", "사무실", "회의", "회의실", "팀장님", "과장님", "메일", "전화", "자료", "보고서", "일", "컴퓨터", "복사", "커피", "오늘", "내일", "오전", "오후", "몇 시", "주말", "문제", "보내다"],
  중급: ["일정", "출장", "손님", "고객", "거래처", "발표", "계획", "방법", "의견", "확인하다", "준비하다", "정리하다", "연락하다", "끝나다", "늦다", "바쁘다", "퇴근하다", "출근하다"],
  고급: ["결과", "제품", "주문", "예약", "회신", "첨부 파일", "담당자", "참석하다", "제출하다", "변경하다", "결정하다"],
};

/** 서버 안내 끝에 붙이는 형식 안내 ("더 보기" 줄 누락 방지: 프롬프트 중간 지시보다 instructions 끝이 잘 지켜짐) */
const FORMAT_REMINDER = `- 형식: 세 항목 모두 "- 문형:" 줄 아래에 "· 기능", "· 만들기", "· 더 보기" 줄을 넣습니다. "· 더 보기:" 줄은 어느 항목에서도 빼지 않습니다.`;

/** 서버 안내 끝에 붙이는 '-님' 사용 안내 ("저는 과장님입니다"처럼 자기에게 '-님'을 붙이는 오류 방지) */
const HONORIFIC_REMINDER = `- 높임: 자기 이름·직책에는 '-님'을 붙이지 않습니다. 자기소개는 "저는 영업팀 마이클입니다", "저는 김민수 과장입니다"처럼 소속·이름·직책으로 하고, '-님'은 상대나 다른 사람(팀장님, 과장님)을 부르거나 가리킬 때만 씁니다. (예: "저는 과장님입니다" × → "저는 김민수 과장입니다" ○)`;

/** 서버 안내용 어휘 안내: 이 난이도에서 쓸 수 있는 어휘(아래 단계 포함)와 쓰지 않을 위 단계 어휘 */
function vocabInstruction(level: Level): string {
  const idx = LEVELS.indexOf(level);
  const allowed = LEVELS.slice(0, idx + 1).flatMap((l) => VOCAB[l]);
  const higher = LEVELS.slice(idx + 1).flatMap((l) => VOCAB[l]);
  const lines = [`- 어휘: ${level}에서는 아래 어휘를 우선 쓰고, 목록 밖 어휘는 같은 수준의 쉬운 말로 씁니다.`, `  · 쓸 수 있는 어휘: ${allowed.join(', ')}`];
  if (higher.length) lines.push(`  · 쓰지 않을 어휘(위 단계): ${higher.join(', ')} — 대표 문장과 "더 보기" 문장 어디에도 쓰지 않습니다.`);
  lines.push(
    level === '초급'
      ? `  · 명사 겹침: 초급은 '회의 자료', '제품 자료'처럼 한자어 명사 두 개를 붙여 쓰지 않습니다. (예: "회의 자료"처럼 쓰지 않음) 단, 자기소개에서 소속을 말하는 '회사·업종 + 직원'(예: 회사 직원, 여행사 직원)은 예외로 초급에서도 씁니다.`
      : `  · 명사 겹침: '회의 자료'처럼 한자어 명사 두 개를 붙인 말은 한 문장에 1개까지만 씁니다.`,
  );
  return lines.join('\n');
}

/**
 * 프롬프트에 들어가는 [주제·난이도별 문형 목록] 본문.
 * 예시 문장은 넣지 않음: 금지 목록에 넣어도 모델이 그대로 베껴 써서 문형 형태와 출처 표시만 보냄.
 * (예시 문장은 이 데이터와 docs/level-guide.md에 교사용으로 남김)
 */
export function patternListText(): string {
  const out: string[] = [];
  for (const g of PATTERN_GROUPS) {
    out.push(`[${g.topic} · ${g.level}]`);
    for (const i of g.items) out.push(`- ${i.form} [${i.tag}]`);
    out.push('');
  }
  return out.join('\n') + '\n';
}

const TOPICS: Topic[] = ['보고', '이메일', '회의'];

/**
 * 문형 비교용 정규화: 모델이 "V-(으)ㄹ까요?"처럼 표기를 바꿔 적어도 목록의 "V-을까요?"와 같게 봄.
 * 공백·'(으)'·품사 표시(N/V/A/A/V-)·물음표·뜻풀이 괄호((순서), (계획) 등)를 지우고 '을까요'를 'ㄹ까요'로 맞춤.
 */
export function normalizeForm(form: string): string {
  return form
    .replace(/\s+/g, '')
    .replace(/\(으\)/g, '')
    .replace(/\([가-힣·]+\)/g, '')
    .replace(/^(?:A\/V|V|A)-/, '')
    .replace(/을까요/g, 'ㄹ까요')
    .replace(/[?？]/g, '');
}

export interface ExpressionContext {
  topic: Topic;
  level: Level;
}

interface SimpleMessage {
  role: string;
  content: string;
}

/** 가장 최근의 "주제: …\n난이도: …" 시작 메시지에서 주제·난이도를 읽음 (목록에 있는 값만 인정) */
export function findExpressionContext(messages: SimpleMessage[]): ExpressionContext | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user' || typeof m.content !== 'string') continue;
    const t = m.content.match(/주제\s*[:：]\s*(보고|이메일|회의)/);
    const l = m.content.match(/난이도\s*[:：]\s*(초급|중급|고급)/);
    if (t && l) return { topic: t[1] as Topic, level: l[1] as Level };
  }
  return null;
}

const MORE_COMMANDS = ['다른 표현', '표현 더 보기', '다른 문형'];

/** 마지막 사용자 메시지가 "다른 표현" 명령이면 블록의 [이미 소개한 문형] 목록을 돌려줌, 아니면 null */
export function parseMoreRequest(lastUserContent: string): string[] | null {
  const firstLine = (lastUserContent.split('\n')[0] || '').trim().replace(/[.!?。]+$/, '');
  if (!MORE_COMMANDS.includes(firstLine)) return null;
  const m = lastUserContent.match(/\[이미 소개한 문형\]\n([^\n]*)/);
  if (!m) return [];
  return m[1].split(',').map((x) => x.trim()).filter(Boolean);
}

/** 마지막 사용자 메시지가 주제·난이도 시작 메시지인지 */
export function isStartRequest(lastUserContent: string): boolean {
  return /주제\s*[:：]\s*(보고|이메일|회의)/.test(lastUserContent) && /난이도\s*[:：]\s*(초급|중급|고급)/.test(lastUserContent);
}

/** 첫 세트(주제·난이도 선택) 응답용: 그 주제·난이도 목록의 예시 문장을 그대로 쓰지 않도록 안내 (서버 데이터만 사용) */
export function buildStartInstruction(ctx: ExpressionContext): string {
  if (!groupOf(ctx.topic, ctx.level)) return '';
  // 예시 문장은 넣지 않음(넣으면 금지해도 그대로 베껴 씀). 어휘·형식·높임 안내만.
  return `\n\n--------------------------------------------------
[서버 안내]
${vocabInstruction(ctx.level)}
${FORMAT_REMINDER}
${HONORIFIC_REMINDER}
- 이 안내는 학습자에게 보이지 않으며, 응답에서 언급하지 않습니다.`;
}

export interface NextPatternChoice {
  items: { form: string; fromTopic: Topic }[];
  /** 3단계(복습)로 넘어갔는지 */
  review: boolean;
}

function groupOf(topic: Topic, level: Level): PatternGroup | undefined {
  return PATTERN_GROUPS.find((g) => g.topic === topic && g.level === level);
}

/**
 * 다음 세트 문형 3개를 고름 (명세 3-3 순서):
 * ① 같은 주제·난이도의 안 쓴 문형 → ② 같은 난이도 다른 주제의 안 쓴 문형 → ③ 이미 소개한 문형 복습
 * 같은 문형이 여러 주제 목록에 있으면(예: V-을까요?) 정규화한 형태로 한 번만 셈.
 */
export function chooseNextPatterns(ctx: ExpressionContext, used: string[], count = 3): NextPatternChoice {
  const usedSet = new Set(used.map(normalizeForm));
  const picked: { form: string; fromTopic: Topic }[] = [];
  const pickedSet = new Set<string>();
  const order: Topic[] = [ctx.topic, ...TOPICS.filter((t) => t !== ctx.topic)];

  for (const topic of order) {
    for (const item of groupOf(topic, ctx.level)?.items ?? []) {
      const key = normalizeForm(item.form);
      if (picked.length >= count) break;
      if (usedSet.has(key) || pickedSet.has(key)) continue;
      picked.push({ form: item.form, fromTopic: topic });
      pickedSet.add(key);
    }
  }
  if (picked.length >= count) return { items: picked, review: false };

  // ③ 복습: 이미 소개한 순서대로, 이 난이도 목록에 있는 문형만 다시 씀
  const levelItems = order.flatMap((topic) => (groupOf(topic, ctx.level)?.items ?? []).map((item) => ({ item, topic })));
  for (const u of used) {
    if (picked.length >= count) break;
    const key = normalizeForm(u);
    if (pickedSet.has(key)) continue;
    const hit = levelItems.find((x) => normalizeForm(x.item.form) === key);
    if (hit) {
      picked.push({ form: hit.item.form, fromTopic: hit.topic });
      pickedSet.add(key);
    }
  }
  return { items: picked, review: true };
}

/**
 * instructions 끝에 붙일 서버 지정 문형 안내.
 * 서버 목록의 문형 형태와 고정 문구만 들어가며, 클라이언트가 보낸 텍스트는 들어가지 않음.
 */
export function buildNextSetInstruction(ctx: ExpressionContext, choice: NextPatternChoice): string {
  if (choice.items.length === 0) return '';
  const lines = choice.items.map((x, i) => {
    const note = x.fromTopic === ctx.topic ? '' : ` (${x.fromTopic} 목록의 문형: 현재 주제 '${ctx.topic}' 장면에 맞게 대표 문장을 새로 만듦)`;
    return `${i + 1}. ${x.form}${note}`;
  });
  const review = choice.review
    ? `\n- 이번 세트는 [목록을 다 썼을 때의 순서]의 3단계(복습)입니다. 이미 소개한 문형을 다시 쓰는 항목은 대표 문장을 완전히 새로 만들고 항목 제목 끝에 "(복습)"을 붙입니다. 세트 제목 아래에 복습 안내 줄을 넣습니다.`
    : '';
  return `\n\n--------------------------------------------------
[이번 세트 문형 (서버 지정)]
이번 "다른 표현" 응답에서는 아래 문형 3개만 이 순서대로 소개합니다. 다른 문형으로 바꾸지 않습니다.
${lines.join('\n')}
- 대표 문장과 "더 보기" 문장은 사용자 메시지의 [이미 쓴 대표 문장]과 같거나 거의 같지 않게 새로 만듭니다.${review}
${vocabInstruction(ctx.level)}
${FORMAT_REMINDER}
${HONORIFIC_REMINDER}
- 이 안내는 학습자에게 보이지 않으며, 응답에서 언급하지 않습니다.`;
}

export const _internal = { TOPICS, LEVELS };
