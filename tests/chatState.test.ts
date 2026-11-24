import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildExpressionPayload } from '../src/utils/chatState.ts';
import { buildHistoryBlock, extractIntroItems, isHistoryCommand, mergeHistory, EMPTY_HISTORY } from '../src/utils/expressionHistory.ts';
import { buildUsageBlock, emptyUsage } from '../src/utils/supportUsage.ts';

describe('표시용·전송용 메시지 분리', () => {
  test('인사말 제외, apiContent 우선, 메타 블록 제거, 빈 placeholder 제외', () => {
    const payload = buildExpressionPayload([
      { id: 'init-msg', role: 'assistant', content: '안녕하세요! 화면 인사말' },
      { id: 'u1', role: 'user', content: '다른 표현', apiContent: '다른 표현\n\n[이미 소개한 문형]\nV-고' },
      { id: 'a1', role: 'assistant', content: '결과: 🟡\n[[NOTES]][][[/NOTES]]' },
      { id: 'a2', role: 'assistant', content: '' },
    ]);
    assert.deepEqual(payload, [
      { role: 'user', content: '다른 표현\n\n[이미 소개한 문형]\nV-고' },
      { role: 'assistant', content: '결과: 🟡' },
    ]);
  });
});

describe('이미 소개한 문형 기록', () => {
  const intro = '1단계: 표현 소개 (세트 1 · 여행사)\n1. 메일을 보냈어요.\n- 문형: V-았/었어요 [Y2-9·추정]\n2. 오늘 끝낼 수 있어요.\n- 문형: V-(으)ㄹ 수 있다';
  test('문형·대표 문장 추출(출처 표시 제거)', () => {
    assert.deepEqual(extractIntroItems(intro), { patterns: ['V-았/었어요', 'V-(으)ㄹ 수 있다'], sentences: ['메일을 보냈어요.', '오늘 끝낼 수 있어요.'] });
    assert.deepEqual(extractIntroItems('결과: ✅ 정답\n1. 내 답'), { patterns: [], sentences: [] });
  });
  test('명령어에만 블록을 붙임', () => {
    assert.equal(isHistoryCommand('다른 표현'), true);
    assert.equal(isHistoryCommand('퀴즈시작.'), true);
    assert.equal(isHistoryCommand('보냈어요'), false);
    const block = buildHistoryBlock(mergeHistory(EMPTY_HISTORY, intro));
    assert.match(block, /\[이미 소개한 문형\]\nV-았\/었어요, V-\(으\)ㄹ 수 있다\n\[이미 쓴 대표 문장\]\n메일을 보냈어요\. \/ 오늘 끝낼 수 있어요\./);
    assert.equal(buildHistoryBlock(EMPTY_HISTORY), '');
  });
});

describe('도움 사용 기록 블록', () => {
  test('기록이 없으면 붙이지 않음', () => assert.equal(buildUsageBlock(emptyUsage(), 2), ''));
  test('모두 그대로 보냈으면 "직접 쓴 발화: 없음"', () => {
    const u = emptyUsage();
    u.counts.choices = 1;
    u.helped.push({ index: 1, source: 'choices', modified: false });
    assert.match(buildUsageBlock(u, 1), /직접 쓴 발화: 없음/);
    u.helped.push({ index: 2, source: 'model', modified: true });
    assert.doesNotMatch(buildUsageBlock(u, 2), /직접 쓴 발화: 없음/);
  });
});

test('직접 쓴 발화가 있으면 수를 적음 (도움으로 시작한 발화가 없어도)', () => {
  const u = emptyUsage();
  u.counts.hint = 1;
  const block = buildUsageBlock(u, 2);
  assert.match(block, /직접 쓴 발화: 2개/);
  assert.doesNotMatch(block, /직접 쓴 발화: 없음/);
});

test('다른 도움 받기 횟수가 도움 사용 기록에 들어감', () => {
  const u = emptyUsage();
  u.refresh = 1;
  assert.match(buildUsageBlock(u, 1), /다른 도움 받기 1회/);
  assert.doesNotMatch(buildUsageBlock({ ...emptyUsage(), counts: { hint: 1, frame: 0, choices: 0, model: 0 } }, 1), /다른 도움 받기/);
});
test('표현 연습 대화의 난이도 읽기 (없으면 중급)', async () => {
  const { expressionLevel } = await import('../src/utils/chatState.ts');
  assert.equal(expressionLevel([{ role: 'user', content: '주제: 보고\n난이도: 초급\n시작' }, { role: 'assistant', content: '난이도: 고급' }]), '초급');
  assert.equal(expressionLevel([{ role: 'user', content: '안녕하세요' }]), '중급');
});
