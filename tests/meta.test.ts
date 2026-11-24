import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractNotes,
  extractResult,
  verdictFromResultLine,
  extractSupport,
  replyToMatches,
  stripInternalMarkers,
  cleanDisplayContent,
  stripMetaForHistory,
  countEojeol,
  validateFrame,
  validateChoices,
  beginnerSupportIssue,
} from '../src/utils/meta.ts';

const quiet = () => {
  const warn = console.warn;
  console.warn = () => {};
  return () => (console.warn = warn);
};

describe('NOTES 추출', () => {
  const item = { scene: '보고 표현 연습', counterpart: '팀장님', original: '말하겠습니다', corrected: '말씀드리겠습니다', category: '높임법', reason: '상사에게는 겸양 표현' };
  test('앞뒤 문장이 있어도 블록만 읽음', () => {
    const t = `결과: 🟡 부분 정답\n설명…\n[[NOTES]]\n${JSON.stringify([item])}\n[[/NOTES]]\n끝 문장`;
    assert.deepEqual(extractNotes(t), [item]);
  });
  test('코드 펜스가 있어도 읽음', () => {
    const t = `[[NOTES]]\n\`\`\`json\n${JSON.stringify([item])}\n\`\`\`\n[[/NOTES]]`;
    assert.equal(extractNotes(t).length, 1);
  });
  test('빈 배열·잘못된 범주·깨진 JSON은 빈 목록', () => {
    assert.deepEqual(extractNotes('[[NOTES]][][[/NOTES]]'), []);
    assert.deepEqual(extractNotes(`[[NOTES]]${JSON.stringify([{ ...item, category: '기타' }])}[[/NOTES]]`), []);
    assert.deepEqual(extractNotes('[[NOTES]][{"scene":[[/NOTES]]'), []);
    assert.deepEqual(extractNotes('블록 없음'), []);
  });
});

describe('RESULT 추출과 결과 줄 대체 판독', () => {
  test('블록 우선', () => {
    assert.deepEqual(extractResult('결과: ❌ 오답\n[[RESULT]]{"verdict":"partial","correct":false}[[/RESULT]]'), { verdict: 'partial', correct: false });
  });
  test('코드 펜스가 있어도 읽음', () => {
    assert.equal(extractResult('[[RESULT]]```json\n{"verdict":"alternative","correct":true}\n```[[/RESULT]]')?.verdict, 'alternative');
  });
  test('verdict 없이 correct만 있는 옛 형식', () => {
    assert.deepEqual(extractResult('[[RESULT]]{"correct":true}[[/RESULT]]'), { verdict: 'correct', correct: true });
  });
  test('"✅ 정답(다른 적절한 표현)"을 "✅ 정답"보다 먼저 판별', () => {
    assert.equal(verdictFromResultLine('결과: ✅ 정답(다른 적절한 표현)'), 'alternative');
    assert.equal(verdictFromResultLine('결과: ✅ 정답 (다른 적절한 표현)'), 'alternative');
    assert.equal(verdictFromResultLine('결과: ✅ 정답'), 'correct');
    assert.equal(verdictFromResultLine('결과: 🟡 부분 정답'), 'partial');
    assert.equal(verdictFromResultLine('결과: ❌ 오답'), 'incorrect');
    assert.equal(verdictFromResultLine('판정 없음'), null);
  });
  test('블록이 잘렸으면 결과 줄로 대신 읽음', () => {
    const restore = quiet();
    try {
      assert.deepEqual(extractResult('결과: ✅ 정답(다른 적절한 표현)\n…\n[[RESULT]]{"verdict":"alter'), { verdict: 'alternative', correct: true });
      assert.equal(extractResult('아무 판정도 없음'), null);
    } finally {
      restore();
    }
  });
});

describe('SUPPORT 추출·분류', () => {
  const choices = {
    options: [
      { id: 'A', text: '네, 금요일에 보내요.', verdict: 'appropriate', reason: '분명해요', reason_en: '' },
      { id: 'B', text: '금요일에 보내요. 네.', verdict: 'partial', reason: '대답이 늦어요', reason_en: '' },
      { id: 'C', text: '금요일에 보내.', verdict: 'inappropriate', reason: '반말이에요', reason_en: '' },
    ],
  };
  const wrap = (o: object) => `[[SUPPORT]]${JSON.stringify(o)}[[/SUPPORT]]`;
  test('코드 펜스·앞뒤 문장이 있어도 읽음', () => {
    const r = extractSupport(`도움입니다.\n[[SUPPORT]]\`\`\`json\n${JSON.stringify({ type: 'choices', replyTo: '언제 보내요?', intent: '', intent_en: '', ...choices })}\n\`\`\`[[/SUPPORT]]\n끝`, 'choices');
    assert.equal(r.ok, true);
  });
  test('블록 마커가 없으면 첫 { ~ 마지막 }을 읽음', () => {
    const r = extractSupport(`앞말 ${JSON.stringify({ type: 'model', replyTo: '언제요?', text: '금요일에 보내요.', tip: '날짜를 말해요.' })} 뒷말`, 'model');
    assert.equal(r.ok, true);
  });
  test('닫는 마커가 없으면 truncated', () => {
    const r = extractSupport('[[SUPPORT]]{"type":"hint","replyTo":"x","steps":["a"', 'hint');
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.kind, 'truncated');
  });
  test('마커 없이 괄호가 덜 닫혔으면 truncated, 문법 오류면 parse', () => {
    const a = extractSupport('{"type":"hint","replyTo":"x","steps":["a","b"]', 'hint');
    assert.equal(!a.ok && a.kind, 'truncated');
    const b = extractSupport('{"type":"hint", replyTo: x}', 'hint');
    assert.equal(!b.ok && b.kind, 'parse');
  });
  test('replyTo 필수', () => {
    const r = extractSupport(wrap({ type: 'model', replyTo: '', text: '네.', tip: '팁' }), 'model');
    assert.equal(!r.ok && r.kind, 'schema');
  });
  test('{{n}}은 frame.template 밖에서 금지(placeholder)', () => {
    const bad = { ...choices, options: choices.options.map((o, i) => (i === 0 ? { ...o, text: '{{1}}에 보내요.' } : o)) };
    const r = extractSupport(wrap({ type: 'choices', replyTo: '언제요?', ...bad }), 'choices');
    assert.equal(!r.ok && r.kind, 'placeholder');
    const m = extractSupport(wrap({ type: 'model', replyTo: '언제요?', text: '금요일에 보내요.', tip: '{{1}} 자리에 날짜' }), 'model');
    assert.equal(!m.ok && m.kind, 'placeholder');
  });
  test('type이 요청과 다르면 schema', () => {
    const r = extractSupport(wrap({ type: 'hint', replyTo: 'x', steps: ['a', 'b'] }), 'model');
    assert.equal(!r.ok && r.kind, 'schema');
  });
  test('starter: 틀과 정답 보기 구조가 같으면 조사를 틀에 옮김, 다르면 schema', () => {
    const frame = { template: '{{1}}에 회의해요.', blanks: [{ id: 1, hint: '요일', hint_en: 'day' }] };
    const ok = extractSupport(wrap({ type: 'starter', replyTo: '언제요?', intent: '', intent_en: '', frame, choices }), 'starter');
    // 정답 "네, 금요일에 보내요."는 틀 "{{1}}에 회의해요."를 채운 문장이 될 수 없음
    assert.equal(!ok.ok && ok.kind, 'schema');
    const frame2 = { template: '네, {{1}} 보내요.', blanks: [{ id: 1, hint: '요일', hint_en: 'day' }] };
    const ok2 = extractSupport(wrap({ type: 'starter', replyTo: '언제요?', intent: '', intent_en: '', frame: frame2, choices }), 'starter');
    assert.equal(ok2.ok, true);
    assert.equal(ok2.ok && ok2.data.type === 'starter' && ok2.data.frame.template, '네, {{1}}에 보내요.');
  });
});

describe('검증 함수', () => {
  test('choices verdict는 appropriate·partial·inappropriate 각 1개', () => {
    const o = (verdict: string, text: string) => ({ id: text, text, verdict, reason: 'r' });
    assert.equal(typeof validateChoices({ options: [o('appropriate', '가'), o('partial', '나'), o('inappropriate', '다')] }), 'object');
    assert.equal(typeof validateChoices({ options: [o('appropriate', '가'), o('appropriate', '나'), o('inappropriate', '다')] }), 'string');
    assert.equal(typeof validateChoices({ options: [o('appropriate', '가'), o('partial', '나')] }), 'string');
    // 문장부호만 다른 보기는 같은 보기
    assert.equal(typeof validateChoices({ options: [o('appropriate', '가요.'), o('partial', '가요?'), o('inappropriate', '다')] }), 'string');
  });
  test('frame: 빈칸 id 일치, 1~3개, 문장 끝 빈칸 금지', () => {
    const b = (id: number) => ({ id, hint: '날짜', hint_en: 'date' });
    assert.equal(typeof validateFrame({ template: '{{1}}에 {{2}} 보내요.', blanks: [b(1), b(2)] }), 'object');
    assert.equal(typeof validateFrame({ template: '{{1}}에 {{3}} 보내요.', blanks: [b(1), b(2)] }), 'string');
    assert.equal(typeof validateFrame({ template: '보내요.', blanks: [] }), 'string');
    assert.equal(typeof validateFrame({ template: '{{1}} {{2}} {{3}} {{4}} 보내요.', blanks: [b(1), b(2), b(3), b(4)] }), 'string');
    assert.equal(typeof validateFrame({ template: '장소에 {{1}}.', blanks: [b(1)] }), 'string');
  });
  test('frame: 빈칸 뒤 고정 조사는 틀에서 빼고 힌트에 조사 쌍을 붙임', () => {
    const f = validateFrame({ template: '{{1}}이 있어요.', blanks: [{ id: 1, hint: '문제', hint_en: 'problem' }] });
    assert.ok(typeof f === 'object');
    assert.equal(f.template, '{{1}} 있어요.');
    assert.equal(f.blanks[0].hint, '문제 + 이/가');
  });
  test('초급 범위 점검: 때문에는 실패, -(으)니까는 허용, 죄송 앞 -(으)니까는 실패', () => {
    const model = (text: string) => ({ type: 'model' as const, replyTo: 'x', intent: '', intent_en: '', text, text_en: '', tip: 't', tip_en: '' });
    assert.match(beginnerSupportIssue(model('자료 때문에 늦어요.')) ?? '', /이유 문형/);
    assert.equal(beginnerSupportIssue(model('시간이 없으니까 빨리 해요.')), null);
    assert.match(beginnerSupportIssue(model('늦었으니까 죄송해요.')) ?? '', /이유 문형/);
    assert.match(beginnerSupportIssue(model('오늘 오후에 팀장님께 보고서를 다시 보내 드려요.')) ?? '', /어절 수 초과/);
  });
});

describe('replyTo 비교', () => {
  const actual = '지금 잠깐 괜찮아요? 보고서는 어떻게 되고 있어요?';
  test('완전 일치', () => assert.equal(replyToMatches(actual, actual), true));
  test('문장부호·공백 차이', () => assert.equal(replyToMatches('지금 잠깐 괜찮아요 보고서는 어떻게 되고 있어요', actual), true));
  test('포함', () => assert.equal(replyToMatches('보고서는 어떻게 되고', actual), true));
  test('발화 중 한 문장과 일치', () => assert.equal(replyToMatches('보고서는 어떻게 되고 있어요?', actual), true));
  test('[난이도] 표시가 붙어도 일치', () => assert.equal(replyToMatches('[난이도: 초급] ' + actual, actual), true));
  test('불일치', () => assert.equal(replyToMatches('회의는 몇 시에 해요?', actual), false));
  test('빈 문자열은 불일치', () => assert.equal(replyToMatches('', actual), false));
});

describe('내부 표시 제거', () => {
  test('[난이도: …] 표시', () => {
    assert.equal(stripInternalMarkers('[난이도: 초급] 안녕하세요.'), '안녕하세요.');
  });
  test('출처 표시', () => {
    assert.equal(stripInternalMarkers('- 문형: V-았/었어요 [Y2-9·추정]'), '- 문형: V-았/었어요');
    assert.equal(stripInternalMarkers('- 문형: 보고드리겠습니다 [격식]'), '- 문형: 보고드리겠습니다');
  });
  test('이미 소개한 문형 블록', () => {
    const t = '1단계: 표현 소개\n\n[이미 소개한 문형]\nV-았/었어요, N부터 N까지\n[이미 쓴 대표 문장]\n메일을 보냈어요.\n\n본문';
    assert.equal(stripInternalMarkers(t), '1단계: 표현 소개\n\n본문');
  });
  test('도움 사용 기록 블록', () => {
    assert.equal(stripInternalMarkers('피드백\n[도움 사용 기록]\n방향 힌트 1회\n'), '피드백\n');
  });
  test('이메일 자리표시는 남김', () => {
    assert.equal(stripInternalMarkers('[담당자명]님께 [날짜]까지'), '[담당자명]님께 [날짜]까지');
  });
  test('화면 표시: 메타 블록과 스트리밍 중 마커 꼬리 숨김', () => {
    assert.equal(cleanDisplayContent('본문\n[[NOTES]][][[/NOTES]]'), '본문');
    assert.equal(cleanDisplayContent('본문\n[[RES'), '본문');
    assert.equal(cleanDisplayContent('본문 [[NO'), '본문');
  });
  test('재전송용: 메타 블록 제거(잘린 블록 포함)', () => {
    assert.equal(stripMetaForHistory('본문\n[[RESULT]]{"verdict":"correct"}[[/RESULT]]'), '본문');
    assert.equal(stripMetaForHistory('본문\n[[NOTES]][{"a":'), '본문');
  });
});

describe('어절 수 세기', () => {
  const cases: [string, number][] = [
    ['메일을 보냈어요.', 2],
    ['회의는 오후 두 시부터 세 시까지예요.', 3],
    ['오늘 안에 이 일을 끝낼 수 있어요.', 5],
    ['장소 계약에 문제가 있어서 준비가 조금 늦어지고 있습니다.', 7],
    ['다만 장소 계약에 문제가 하나 있어 확인 중입니다.', 7],
    ['자료를 내일까지 보내 주세요.', 3],
    ['확인해 주시겠어요?', 1],
    ['전화 주세요.', 2],
    ['자료를 주세요.', 2],
    ['늦을 수도 있어요.', 1],
    ['오전 열 시 반에 만나요.', 2],
    ['(동료에게) 내일까지 보내 주세요.', 2],
    ['', 0],
  ];
  for (const [s, n] of cases) test(`"${s}" → ${n}`, () => assert.equal(countEojeol(s), n));
});
