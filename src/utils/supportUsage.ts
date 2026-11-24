/**
 * 롤플레이 도움 사다리 사용 기록과, [피드백 받기] 때 전송용 메시지 끝에만 붙이는 [도움 사용 기록] 블록.
 * (말풍선과 instructions에는 넣지 않음)
 */

export type UsageStep = 'hint' | 'frame' | 'choices' | 'model';
export type UsageSource = 'frame' | 'choices' | 'model';
export type UsageVerdict = 'appropriate' | 'partial' | 'inappropriate';

export interface SupportUsage {
  counts: Record<UsageStep, number>;
  firstChoices: UsageVerdict[];
  /** [입력창에 넣기]로 시작한 발화: 몇 번째 발화인지, 출처, 보내기 전에 고쳤는지 */
  helped: { index: number; source: UsageSource; modified: boolean }[];
}

export const emptyUsage = (): SupportUsage => ({
  counts: { hint: 0, frame: 0, choices: 0, model: 0 },
  firstChoices: [],
  helped: [],
});

const SOURCE_NAME: Record<UsageSource, string> = { frame: '문장 틀', choices: '보기 선택', model: '모범 답' };

/**
 * @param u 사용 기록
 * @param userTurns 피드백 요청 전까지 학습자가 보낸 발화 수
 * @returns 사용 기록이 없으면 빈 문자열
 */
export function buildUsageBlock(u: SupportUsage, userTurns: number): string {
  const total = u.counts.hint + u.counts.frame + u.counts.choices + u.counts.model + u.helped.length;
  if (total === 0) return '';
  const first = u.firstChoices.length ? `(처음 선택: ${u.firstChoices.join(', ')})` : '';
  const lines = [
    `방향 힌트 ${u.counts.hint}회, 문장 틀 ${u.counts.frame}회, 보기 선택 ${u.counts.choices}회${first}, 모범 답 ${u.counts.model}회`,
    u.helped.length
      ? `도움으로 시작한 발화: ${u.helped.map((h) => `${h.index}번째(${SOURCE_NAME[h.source]}, ${h.modified ? '수정함' : '그대로'})`).join(', ')}`
      : '도움으로 시작한 발화: 없음',
  ];
  // 학습자 발화가 모두 도움 문장을 그대로 보낸 것이면, 모델이 바로 앞에서 읽도록 끝에 명시
  const allVerbatim = userTurns > 0 && u.helped.length === userTurns && u.helped.every((h) => !h.modified);
  if (allVerbatim) lines.push('직접 쓴 발화: 없음 (잘한 점에 발화를 인용하지 말 것)');
  else {
    // 직접 쓴 발화가 있으면 그 수를 분명히 적음 (모델이 "도움으로 시작한 발화: 없음"을 "직접 쓴 발화 없음"으로 잘못 읽은 사례가 있었음)
    const direct = Math.max(0, userTurns - u.helped.filter((h) => !h.modified).length);
    lines.push(`직접 쓴 발화: ${direct}개 (이 발화들은 평소처럼 피드백함)`);
  }
  return `\n\n[도움 사용 기록]\n${lines.join('\n')}`;
}
