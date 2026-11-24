import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDisplayContent, stripMetaForHistory, hasEndMarker } from '../src/utils/meta.ts';
import { isClosingUtterance, nearlySame, detectEnding, decideEnding, type TurnMessage } from '../src/utils/ending.ts';
import { supportPanelState, buildRoleplayPayload } from '../src/utils/chatState.ts';

const ai = (content: string): TurnMessage => ({ role: 'assistant', content });
const me = (content: string): TurnMessage => ({ role: 'user', content });

describe('[[END]] 표시', () => {
  test('화면에서 숨기고, 다음 요청의 대화 기록에서도 지움', () => {
    const reply = '네, 목요일에 뵙겠습니다. [[END]]';
    assert.equal(cleanDisplayContent(reply), '네, 목요일에 뵙겠습니다.');
    assert.equal(stripMetaForHistory(reply), '네, 목요일에 뵙겠습니다.');
    assert.equal(hasEndMarker(reply), true);
    assert.equal(hasEndMarker('네, 목요일에 뵙겠습니다.'), false);
    const payload = buildRoleplayPayload([{ id: 'a', role: 'assistant', content: reply }, { id: 'u', role: 'user', content: '감사합니다.' }]);
    assert.equal(payload[0].content, '네, 목요일에 뵙겠습니다.');
  });
  test('스트리밍 중 "[[EN"처럼 잘린 꼬리도 숨김', () => {
    assert.equal(cleanDisplayContent('네, 감사합니다. [[EN'), '네, 감사합니다.');
    assert.equal(cleanDisplayContent('네, 감사합니다. [[END'), '네, 감사합니다.');
  });
});

describe('끝인사·반복 비교 함수', () => {
  test('끝인사 감지 (첫인사 "안녕하세요"는 끝인사가 아님)', () => {
    assert.equal(isClosingUtterance('감사합니다. 목요일에 뵙겠습니다.'), true);
    assert.equal(isClosingUtterance('네, 그럼 목요일에 봬요.'), true);
    assert.equal(isClosingUtterance('수고하세요.'), true);
    assert.equal(isClosingUtterance('안녕하세요. 저는 미래전자 직원이에요.'), false);
    assert.equal(isClosingUtterance('감사합니다. 그럼 목요일 괜찮으세요?'), false, '감사 뒤에 질문을 이어 가면 끝인사가 아님');
  });
  test('거의 같음: 포함 / 80% 이상 / 짧은 대답은 제외', () => {
    assert.equal(nearlySame('네, 목요일에 뵈어요. 감사합니다.', '목요일에 뵈어요 감사합니다'), true);
    assert.equal(nearlySame('네, 그럼 목요일에 뵙겠습니다. 감사합니다.', '네, 목요일에 뵙겠습니다. 감사합니다.'), true);
    assert.equal(nearlySame('네.', '네.'), false);
    assert.equal(nearlySame('그럼 언제가 좋아요?', '네, 괜찮아요. 목요일 오전 10시에 봬요.'), false);
  });
});

describe('종료 감지 3가지 조건 (학습자 발화 3번 이상)', () => {
  const base = [ai('네, 한빛상사 최민수입니다.'), me('안녕하세요. 저는 미래전자 직원이에요.'), ai('네, 무슨 일이세요?'), me('죄송해요. 미팅을 다음 주로 미루고 싶어요.'), ai('그럼 언제가 좋아요?')];
  test('① 상대역의 최근 두 발화가 거의 같음', () => {
    const m = [...base, me('목요일 오전 10시 괜찮으세요?'), ai('네, 목요일에 뵈어요. 감사합니다.'), me('네, 고맙습니다. 목요일에 만나요.'), ai('네, 그럼 목요일에 뵈어요. 감사합니다.')];
    assert.equal(detectEnding(m), 'assistant-repeat');
  });
  test('② 학습자의 최근 두 발화가 거의 같음', () => {
    const m = [...base, me('목요일 오전 10시 괜찮으세요?'), ai('목요일은 조금 어려워요. 다른 날은요?'), me('목요일 오전 10시 괜찮으세요?')];
    assert.equal(detectEnding(m), 'learner-repeat');
  });
  test('③ 상대역 끝인사 + 바로 앞 학습자 끝인사', () => {
    const m = [...base, me('목요일 오전 10시 괜찮으세요?'), ai('네, 괜찮아요.'), me('감사합니다. 목요일에 뵙겠습니다.'), ai('네, 들어가세요.')];
    assert.equal(detectEnding(m), 'closing-exchange');
  });
  test('대화 첫머리 인사는 종료가 아님 (학습자 발화 3번 미만)', () => {
    assert.equal(detectEnding([ai('네, 한빛상사 최민수입니다.'), me('안녕하세요.'), ai('네, 안녕하세요. 감사합니다.')]), null);
    assert.equal(detectEnding(base), null);
  });
  test('대화가 이어지는 중이면 종료가 아님', () => {
    assert.equal(detectEnding([...base, me('목요일 오전 10시 괜찮으세요?'), ai('네, 괜찮아요. 장소는 어디가 좋아요?')]), null);
  });
  test('decideEnding: [[END]]가 있으면 marker, [대화 이어 가기] 뒤에는 이어 간 지점부터만 감지', () => {
    assert.equal(decideEnding(base, ['그럼 언제가 좋아요? [[END]]']), 'marker');
    assert.equal(decideEnding(base, ['처음 응답 [[END]]', '다시 받은 응답']), 'marker');
    const repeated = [...base, me('목요일 오전 10시 괜찮으세요?'), ai('네, 목요일에 뵈어요. 감사합니다.'), me('네, 고맙습니다. 목요일에 만나요.'), ai('네, 그럼 목요일에 뵈어요. 감사합니다.')];
    assert.equal(decideEnding(repeated, ['…']), 'assistant-repeat');
    const afterResume = [...repeated, me('그런데 자료도 필요해요.'), ai('네, 어떤 자료요?')];
    assert.equal(decideEnding(afterResume, ['네, 어떤 자료요?'], repeated.length), null, '이어 간 뒤 새 대화만 보면 종료가 아님');
  });
});

describe('종료 상태에서는 도움 요청이 나가지 않음', () => {
  test('ended이면 도움 패널을 마운트하지 않음(패널이 starter·도움을 요청하지 않음)', () => {
    const messages = [
      { id: 'a1', role: 'assistant' as const, content: '네, 그럼 목요일에 뵙겠습니다. 감사합니다.' },
    ];
    const open = supportPanelState({ stage: 'chat', feedbackRequested: false, isLoading: false, streamingId: null, messages });
    assert.equal(open.showPanel, true);
    const closed = supportPanelState({ stage: 'chat', feedbackRequested: false, isLoading: false, streamingId: null, messages, ended: true });
    assert.equal(closed.showPanel, false);
    assert.equal(closed.showWaiting, false);
  });
});

describe('롤플레이 입력창 안내 문구', async () => {
  const { roleplayInputPlaceholder } = await import('../src/utils/chatState.ts');
  const counterpart = '최 부장(거래처 한빛상사)';
  test('대화 중에는 상대역에게 할 말을 입력하라는 안내', () => {
    assert.match(roleplayInputPlaceholder({ ended: false, feedbackRequested: false, counterpart }), /^최 부장\(거래처 한빛상사\)에게 할 말을 입력하세요/);
  });
  test('종료 카드가 보이는 동안은 [대화 이어 가기] 안내', () => {
    assert.equal(roleplayInputPlaceholder({ ended: true, feedbackRequested: false, counterpart }), '대화가 끝났어요. 이어 가려면 [대화 이어 가기]를 누르세요.');
  });
  test('피드백을 받아 종료 카드가 사라진 뒤에는 [장면 변경] 안내 (없는 버튼을 안내하지 않음)', () => {
    const text = roleplayInputPlaceholder({ ended: true, feedbackRequested: true, counterpart });
    assert.equal(text, '피드백을 받았어요. 다시 하려면 [장면 변경]을 누르세요.');
    assert.doesNotMatch(text, /대화 이어 가기/);
  });
});
