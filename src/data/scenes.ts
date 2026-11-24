export interface SceneCardData {
  id: string;
  title: string;
  counterpart: string;
  situation: string;
  goal: string;
  firstMessage: string;
  /** 초급 롤플레이 첫 대사 (짧은 해요체) */
  openingLineBeginner: string;
  badge: string;
}

export const SCENES: SceneCardData[] = [
  {
    id: 'report-delay',
    title: '일정 지연 보고',
    counterpart: '김 팀장(직속 상사)',
    situation: '금요일까지 내기로 한 시장 조사 보고서가 자료 수집 지연으로 다음 주 화요일로 늦어질 것 같음',
    goal: '결론(지연) → 원인 → 대책·새 일정 순서로 보고하기',
    firstMessage: '지금 잠깐 괜찮아요? 지난주에 맡긴 시장 조사 보고서는 어떻게 되고 있어요?',
    openingLineBeginner: '보고서는 어떻게 돼요?',
    badge: '보고',
  },
  {
    id: 'report-progress',
    title: '업무 중간보고',
    counterpart: '김 팀장',
    situation: '행사 준비가 약 70% 진행됐고, 장소 계약에 문제가 하나 있음',
    goal: '핵심 먼저, 수치로 짧게 보고하기',
    firstMessage: '이번 행사 준비 진행 상황 좀 간단히 말해 줄래요?',
    openingLineBeginner: '행사는 어떻게 돼요? 준비 많이 했어요?',
    badge: '보고',
  },
  {
    id: 'meeting-disagree',
    title: '회의에서 반대 의견 부드럽게 말하기',
    counterpart: '박 과장(회의 진행자)',
    situation: '신제품 홍보를 SNS 광고로만 하자는 제안에 예산·주 고객층 문제로 다른 의견이 있음',
    goal: '상대 의견 인정 → 완곡한 반대 → 근거 → 대안',
    firstMessage: '그럼 이번 홍보는 SNS 광고로만 진행하는 걸로 정리할게요. 다른 의견 있으세요?',
    openingLineBeginner: 'SNS 광고만 할까요? 다른 생각 있어요?',
    badge: '회의',
  },
  {
    id: 'meeting-schedule',
    title: '회의 일정 조율',
    counterpart: '이 대리(다른 팀 동료)',
    situation: '목요일 오후 회의에 출장 때문에 참석하기 어려움',
    goal: '사정 설명 + 대안 시간 제시',
    firstMessage: '목요일 오후 2시 회의 초대 보냈는데 확인했어요?',
    openingLineBeginner: '목요일 회의, 괜찮아요?',
    badge: '회의',
  },
  {
    id: 'client-postpone',
    title: '거래처 미팅 연기 요청(전화)',
    counterpart: '최 부장(거래처 한빛상사)',
    situation: '내일 오전 미팅을 내부 사정으로 다음 주로 미뤄야 함',
    goal: '사과 → 간단한 사유 → 대안 일정 제안 → 양해 구하기',
    firstMessage: '네, 한빛상사 최민수입니다.',
    openingLineBeginner: '네, 한빛상사 최민수입니다.',
    badge: '거래처',
  },
  {
    id: 'colleague-request',
    title: '다른 부서에 자료 협조 요청',
    counterpart: '정 대리(재무팀)',
    situation: '다음 주 회의에 쓸 예산 자료가 필요하지만 상대도 바쁜 시기임',
    goal: '쿠션어 + 구체적 요청(무엇을, 언제까지)',
    firstMessage: '네, 재무팀 정하나입니다. 무슨 일이세요?',
    openingLineBeginner: '네, 재무팀 정하나입니다. 무슨 일이세요?',
    badge: '협조 요청',
  },
];
