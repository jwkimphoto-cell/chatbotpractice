import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  beginnerSupportIssues,
  beginnerReplyIssues,
  coreAllows,
  supportDifficultyIssues,
  internalMarkerField,
  pickLessDifficult,
  extractSupport,
} from '../src/utils/meta.ts';
import { SCENES } from '../src/data/scenes.ts';
import { SERVER_SCENES } from '../api/_lib/scenes.ts';
import * as prompts from '../api/_lib/prompts.ts';

const model = (text: string) => ({ type: 'model' as const, replyTo: 'x', intent: '', intent_en: '', text, text_en: '', tip: 't', tip_en: '' });
const core = (id: string) => SERVER_SCENES[id].coreVocab;

describe('장면 핵심 어휘(coreVocab)', () => {
  test('화면과 서버의 coreVocab이 같고, 장면당 8개 이하', () => {
    for (const s of SCENES) {
      assert.deepEqual(s.coreVocab, SERVER_SCENES[s.id].coreVocab, s.id);
      assert.ok(s.coreVocab.length > 0 && s.coreVocab.length <= 8, s.id);
    }
    assert.equal(SCENES.length, Object.keys(SERVER_SCENES).length);
  });

  test('coreVocab 낱말("미팅을", "다음 주에", "미뤄도")이 초급 검사를 통과', () => {
    assert.deepEqual(beginnerSupportIssues(model('미팅을 다음 주에 미뤄도 돼요?'), core('client-postpone')), []);
    assert.deepEqual(beginnerReplyIssues('미팅을 다음 주에 미뤄도 돼요?', [], core('client-postpone')), []);
  });

  test('위 단계 명사도 그 장면의 coreVocab이면 통과 (회의 일정 조율의 "출장")', () => {
    const t = '목요일은 출장이 있어요.';
    assert.ok(beginnerSupportIssues(model(t)).some((i) => i.kind === 'vocab'), 'coreVocab 없이는 걸림');
    assert.deepEqual(beginnerSupportIssues(model(t), core('meeting-schedule')), []);
    assert.ok(beginnerReplyIssues('출장은 언제 가요?').length > 0);
    assert.deepEqual(beginnerReplyIssues('출장은 언제 가요?', [], core('meeting-schedule')), []);
  });

  test('coreVocab 밖의 어려운 낱말("납품")은 여전히 걸림', () => {
    const issues = beginnerSupportIssues(model('내일 납품이 있어요.'), core('client-postpone'));
    assert.ok(issues.some((i) => i.kind === 'vocab' && i.text.includes('납품')));
    assert.ok(beginnerSupportIssues(model('예약을 바꿔요.'), core('client-postpone')).some((i) => i.text.includes("'예약'")));
  });

  test('활용형·어간 비교', () => {
    assert.equal(coreAllows('미루', ['미루다']), true);
    assert.equal(coreAllows('출장', ['출장']), true);
    assert.equal(coreAllows('예약', ['미팅', '약속']), false);
  });

  test('프롬프트에 장면별 coreVocab과 사용 허용 규칙이 들어감', () => {
    const scene = SERVER_SCENES['client-postpone'];
    const sup = prompts.buildRoleplaySupportInstructions(scene, '초급', 'starter');
    assert.match(sup, /장면 핵심 어휘\(초급에서도 씀\): 미팅, 약속, 내일, 다음 주, 미루다, 죄송하다, 사정, 괜찮다/);
    assert.match(sup, /"장면 핵심 어휘"는 초급에서도 쓸 수 있습니다/);
    assert.match(sup, /용건을 묻는 말.*장면 연습 목표의 첫 단계부터 말하게 합니다.*intent에는 첫 단계/);
    assert.match(prompts.buildRoleplayPrompt(scene, '초급'), /장면 핵심 어휘\(초급에서도 씀\): 미팅/);
  });
});

describe('구조 실패 / 난이도 실패 나누기', () => {
  const starter = (template: string, a: string) => `[[SUPPORT]]${JSON.stringify({
    type: 'starter', replyTo: '무슨 일이세요?', intent: '사과하고 용건 말하기', intent_en: 'Apologize and say why you called',
    frame: { template, blanks: [{ id: 1, hint: '요일', hint_en: 'day' }] },
    choices: { options: [
      { id: 'A', text: a, verdict: 'appropriate', reason: 'r', reason_en: 'r' },
      { id: 'B', text: '미팅을 미뤄요. 죄송해요.', verdict: 'partial', reason: 'r', reason_en: 'r' },
      { id: 'C', text: '미팅 미뤄.', verdict: 'inappropriate', reason: 'r', reason_en: 'r' },
    ] },
  })}[[/SUPPORT]]`;

  test('구조 실패: 빈칸이 문장 끝, {{n}} 노출, 잘림은 extractSupport가 실패로 분류', () => {
    const end = extractSupport(starter('죄송해요. 미팅을 {{1}}.', '죄송해요. 미팅을 미뤄요.'), 'starter');
    assert.equal(!end.ok && end.kind, 'schema');
    const ph = extractSupport(starter('죄송해요. {{1}}로 미뤄요.', '죄송해요. {{1}}로 미뤄요.'), 'starter');
    assert.equal(!ph.ok && ph.kind, 'placeholder');
    assert.equal(extractSupport('[[SUPPORT]]{"type":"starter"', 'starter').ok, false);
  });

  test('구조는 맞고 길이만 넘으면 난이도 실패(목록)로만 돌려줌', () => {
    const r = extractSupport(starter('죄송해요. 내일 오전 미팅을 다음 주 {{1}}로 미뤄요.', '죄송해요. 내일 오전 미팅을 다음 주 화요일로 미뤄요.'), 'starter');
    assert.equal(r.ok, true);
    const issues = r.ok ? supportDifficultyIssues(r.data, '초급', [], core('client-postpone')) : [];
    assert.ok(issues.length > 0 && issues.every((i) => /어절|문장 수/.test(i)), JSON.stringify(issues));
  });

  test('장면 낱말만 쓴 짧은 문장은 난이도 실패 없음', () => {
    const r = extractSupport(starter('죄송해요. 미팅을 {{1}}로 미뤄요.', '죄송해요. 미팅을 화요일로 미뤄요.'), 'starter');
    assert.equal(r.ok, true);
    assert.deepEqual(r.ok ? supportDifficultyIssues(r.data, '초급', [], core('client-postpone')) : null, []);
  });

  test('내부 표시 노출은 구조 실패로 찾음', () => {
    assert.equal(internalMarkerField({ choices: { options: [{ text: '[도움 요청] 미팅' }] } }), 'choices.options[0].text');
    assert.equal(internalMarkerField({ text: '[날짜]까지 보내요.' }), null);
  });

  test('두 결과 중 난이도 위반이 적은 쪽 (같으면 나중)', () => {
    assert.equal(pickLessDifficult({ data: 'a', issues: ['x', 'y'] }, { data: 'b', issues: ['z'] })?.data, 'b');
    assert.equal(pickLessDifficult({ data: 'a', issues: [] }, { data: 'b', issues: ['z'] })?.data, 'a');
    assert.equal(pickLessDifficult({ data: 'a', issues: ['x'] }, { data: 'b', issues: ['z'] })?.data, 'b');
    assert.equal(pickLessDifficult(null, { data: 'b', issues: [] })?.data, 'b');
  });

  test("'-아/어야 하다'(4권)는 초급 문형 위반", () => {
    assert.ok(beginnerSupportIssues(model('미팅을 미뤄야 해요.'), core('client-postpone')).some((i) => i.kind === 'form'));
    assert.deepEqual(beginnerSupportIssues(model('미팅을 미뤄요.'), core('client-postpone')), []);
  });
});

test('반말 보기의 "죄송해."도 한 마디 사과로 보고 문장 수에서 뺌', () => {
  const opts = (c: string) => ({ type: 'choices' as const, replyTo: 'x', intent: '', intent_en: '', options: [
    { id: 'A', text: '죄송해요. 내부 사정이 있어요. 미팅을 다음 주로 미루고 싶어요.', verdict: 'appropriate' as const, reason: 'r', reason_en: '' },
    { id: 'B', text: '내부 사정이 있어요. 미팅을 다음 주로 미루고 싶어요. 죄송해요.', verdict: 'partial' as const, reason: 'r', reason_en: '' },
    { id: 'C', text: c, verdict: 'inappropriate' as const, reason: 'r', reason_en: '' },
  ] });
  assert.deepEqual(beginnerSupportIssues(opts('죄송해. 내부 사정이 있어. 미팅을 다음 주로 미루고 싶어.'), SERVER_SCENES['client-postpone'].coreVocab), []);
});
