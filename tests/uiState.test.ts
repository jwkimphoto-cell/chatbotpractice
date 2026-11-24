import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoleplayPayload, choiceState, supportPanelState, type StoredMessage } from '../src/utils/chatState.ts';

const ai = (id: string, content: string): StoredMessage => ({ id, role: 'assistant', content });
const me = (id: string, content: string, apiContent?: string): StoredMessage => ({ id, role: 'user', content, ...(apiContent ? { apiContent } : {}) });
const base = { stage: 'chat' as const, feedbackRequested: false, isLoading: false, streamingId: null };

describe('도움 패널 표시 조건', () => {
  test('첫 대사 직후: 패널 표시, 대상은 첫 대사', () => {
    const s = supportPanelState({ ...base, messages: [ai('a1', '보고서는 어떻게 돼요?')] });
    assert.deepEqual(s, { showPanel: true, showWaiting: false, target: '보고서는 어떻게 돼요?', turnIndex: 1 });
  });
  test('학습자가 보낸 뒤 스트리밍 중: 패널 대신 준비 중 안내', () => {
    const s = supportPanelState({ ...base, isLoading: true, streamingId: 'a2', messages: [ai('a1', '질문'), me('u1', '대답'), ai('a2', '반쯤 온 말')] });
    assert.equal(s.showPanel, false);
    assert.equal(s.showWaiting, true);
    assert.equal(s.turnIndex, 1, '스트리밍 중인 발화는 세지 않음');
  });
  test('스트리밍이 끝나면 새 턴: turnIndex 증가, 대상은 새 발화(메타 블록 제거)', () => {
    const s = supportPanelState({ ...base, messages: [ai('a1', '질문'), me('u1', '대답'), ai('a2', '그럼 언제 돼요?[[NOTES]][][[/NOTES]]')] });
    assert.equal(s.showPanel, true);
    assert.equal(s.turnIndex, 2);
    assert.equal(s.target, '그럼 언제 돼요?');
  });
  test('피드백 요청 뒤에는 패널·안내 모두 숨김', () => {
    const s = supportPanelState({ ...base, feedbackRequested: true, messages: [ai('a1', '질문'), me('u1', '대답'), ai('a2', '피드백')] });
    assert.equal(s.showPanel || s.showWaiting, false);
  });
  test('장면·난이도 선택 화면에서는 숨김', () => {
    assert.equal(supportPanelState({ ...base, stage: 'select-diff', messages: [ai('a1', '질문')] }).showPanel, false);
  });
  test('마지막 상대역 말이 비어 있으면(오류로 빈 응답) 패널을 띄우지 않음', () => {
    assert.equal(supportPanelState({ ...base, messages: [ai('a1', '질문'), me('u1', '대답'), ai('a2', '   ')] }).showPanel, false);
  });
});

describe('보기 선택 상태', () => {
  const options = [
    { id: 'A', verdict: 'appropriate' as const },
    { id: 'B', verdict: 'partial' as const },
    { id: 'C', verdict: 'inappropriate' as const },
  ];
  test('처음(새 보기)은 선택 없음', () => {
    assert.deepEqual(choiceState(options, []), { wrongCount: 0, pickedCorrect: false, highlightCorrect: false, canInsert: false });
  });
  test('한 번 틀리면 강조 없음, 두 번 틀리면 정답 강조', () => {
    assert.equal(choiceState(options, ['B']).highlightCorrect, false);
    assert.equal(choiceState(options, ['B', 'C']).highlightCorrect, true);
  });
  test('정답을 고르면 입력창에 넣기 가능, 강조 해제', () => {
    const s = choiceState(options, ['B', 'C', 'A']);
    assert.equal(s.canInsert, true);
    assert.equal(s.highlightCorrect, false);
  });
});

describe('롤플레이 전송용 기록', () => {
  test('스트리밍 중 메시지·빈 메시지 제외, [피드백 받기]는 전송용 텍스트(도움 사용 기록) 사용', () => {
    const list = [ai('a1', '질문'), me('u1', '[피드백 요청] 대화를 마치고 피드백을 주세요.', '[피드백 요청] 대화를 마치고 피드백을 주세요.\n\n[도움 사용 기록]\n방향 힌트 1회'), ai('a2', '')];
    assert.deepEqual(buildRoleplayPayload(list, 'a2'), [
      { role: 'assistant', content: '질문' },
      { role: 'user', content: '[피드백 요청] 대화를 마치고 피드백을 주세요.\n\n[도움 사용 기록]\n방향 힌트 1회' },
    ]);
  });
});
