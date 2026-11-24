# 정적 감사 결과 (단계 1)

기준 커밋: `2224b77 wip: 자동 정비 전 상태`. 위치(파일:줄)는 이 커밋 기준입니다.
범위: 이 감사는 이메일 기능 판정(4장, "이메일 관련 수정이 감사 항목의 40%를 넘으면 삭제")의 근거로도 씁니다.

| # | 위치 | 유형 | 문제 | 수정 방침 | 이메일 관련 |
|---|---|---|---|---|---|
| 1 | api/_lib/prompts.ts:295, src/utils/meta.ts:367 | 프롬프트·코드 모순 | '-(으)니까'는 level-guide 3장 회의·초급 목록(2권)에 있는데, 롤플레이 규칙은 초급 금지 문형으로 적고 beginnerSupportIssue는 이 문형이 있으면 실패 처리함 | 2권 문형으로 허용. '죄송·감사' 앞의 '-(으)니까'만 금지(프롬프트·검증 모두) | |
| 2 | api/_lib/prompts.ts:290-294 | 화용 누락 | 롤플레이 초급 문형 목록에 '-(으)ㅂ시다'가 들어가지만 사용 제한(회의 진행·여러 사람)은 표현 연습 프롬프트에만 있음 → 상사에게 '-(으)ㅂ시다' 도움 문장이 나올 수 있음 | HAPSIDA_RULE을 공통 상수로 옮겨 모든 프롬프트에 넣음 | |
| 3 | api/_lib/prompts.ts:93-129, 292-302, api/_lib/patterns.ts:174-189 | 중복 서술 | 난이도 규칙(길이·어절 세기·어휘·명사 겹침·문체)이 세 곳에 따로 적혀 있고 문구가 조금씩 다름 | api/_lib/level-rules.ts의 LEVEL_RULES 하나로 통합, 각 프롬프트·서버 안내가 끼워 씀 | |
| 4 | api/_lib/prompts.ts:9-35, 274-283 | 중복 서술 | PRAGMATIC_GRADING_RULES의 "해설 원칙"과 COMMON_FEEDBACK_PRINCIPLES가 같은 내용을 두 번 서술 | EXPLANATION_PRINCIPLES 하나로 통합, PRAGMATIC_GRADING_RULES·피드백 원칙이 이를 포함 | |
| 5 | api/_lib/prompts.ts:281 | 옛 규칙 잔재 | "중·고급 학습자가 이해할 쉬운 한국어" — 초급 롤플레이 추가 전 문구 | "학습자 난이도에 맞는 쉬운 한국어(초급은 영어 병기)"로 바꿈 | |
| 6 | api/_lib/prompts.ts:229-237 | 예시 = 실제 문항 | 표현 연습 판정 예시 문항("팀장님, 어제 진행한 고객 설문 결과를 ____.")이 회귀 검증 문항과 같음 → 모델이 예시를 그대로 따라 하는지 구분 불가 | 앱에 없는 중립 문항으로 교체 | |
| 7 | api/_lib/prompts.ts:567-573 | 예시 = 실제 문항 | 복습 채점 예시(거래처 / "내일까지 보내 주세요")가 회귀 검증·이메일 예시와 같음 | 중립 예시(고객 / 주소 다시 쓰기)로 교체 | |
| 8 | api/_lib/prompts.ts:515 | 예시 = 실제 문항 | 이메일 첨삭 예시가 표본 E와 같은 문장 | 중립 예시로 교체 | ✔ |
| 9 | api/_lib/prompts.ts:325 | 예시 = 실제 장면 | 롤플레이 되묻기 예시가 '일정 지연 보고' 장면 대사 그대로 | 장면과 무관한 일반 규칙("빠진 목표 단계를 한 번에 하나만 묻기")으로 바꿈 | |
| 10 | api/_lib/prompts.ts:507-546 | 기준 미적용 | 이메일 프롬프트에 공통 난이도 기준(금지 어휘·문체)이 없음 | LEVEL_RULES 삽입, 난이도 정보가 없으므로 고급 기준 적용을 명시 | ✔ |
| 11 | api/_lib/prompts.ts 전체 | 예시 복사 위험 | "예시는 그대로 복사하지 않는다"가 표현 연습·도움 일부에만 있음 | EXAMPLE_POLICY 상수를 모든 프롬프트에 넣음 | |
| 12 | src/components/Chatbot.tsx:404-405, src/utils/meta.ts:85-104 | 내부 표시 노출 | 출처 표시 제거가 표현 연습 탭에서만 동작하고, 전송용 블록([이미 소개한 문형]·[도움 사용 기록])이 응답에 새어 나오면 그대로 보임 | stripInternalMarkers 추가, cleanDisplayContent(모든 탭)가 사용 | |
| 13 | src/components/Chatbot.tsx:178-181 | 표시·전송 분리 | 화면 전용 인사말(INITIAL_GREETING)이 매번 API로 전송됨 | 전송용 기록 생성 함수(buildExpressionPayload)에서 init- 메시지 제외 | |
| 14 | src/components/Chatbot.tsx:199-203 | 상태 초기화 누락 | 🟡/❌ 채점 뒤 노트 저장 상자가 다음 퀴즈·채점 뒤에도 남아 현재 문항 것처럼 보임 | 새 메시지를 보낼 때 저장 후보 초기화 | |
| 15 | Chatbot.tsx:140, RoleplayPractice.tsx:110, EmailCoach.tsx:99·174, ExpressionNotes.tsx:111 | 스트리밍 중 요청 | 중복 전송 방지가 isLoading 상태에만 의존 → 렌더 전에 Enter를 두 번 누르면 두 번 전송 가능 | sendingRef(gradingRef) 가드 추가 | 일부(EmailCoach) |
| 16 | src/components/RoleplaySupportPanel.tsx:205-209 | 상태 오류 | 초급 패널은 loading='starter'로 시작하는데, 캐시 적중으로 끝나면 loading이 풀리지 않아 버튼이 계속 비활성 | 캐시 경로에서도 로딩 해제 | |
| 17 | api/chat.ts:86-90 | 서버 입력 검증 | 메시지 role·content 타입을 검사하지 않음(role 'system'이나 숫자 content가 통과 후 조용히 변환·삭제) | role은 user·assistant, content는 문자열만 허용, 아니면 400 | |
| 18 | api/chat.ts:76-90 | 서버 입력 검증 | roleplay_support 외 모드에서 마지막 메시지가 user인지 검사하지 않음 | 마지막이 user가 아니면 400 | |
| 19 | api/_lib/scenes.ts:76, src/data/scenes.ts | 금지 어휘 | 'colleague-request' 상황 문구에 금지 어휘 '분기'가 들어가 중급·고급 롤플레이에 그대로 전달됨 | "다음 주 회의에 쓸 예산 자료"로 교체 | |
| 20 | api/_lib/scenes.ts:39·42 | 난이도 위반 | 'report-progress' 초급 첫 대사 "행사 준비는 어때요?"와 상황 문구('장소 계약')가 초급에서 금지한 한자어 명사 겹침 | 초급 첫 대사 교체, situationBeginner 추가 | |
| 21 | api/_lib/prompts.ts:252-259 | 난이도 불일치 | 초급 채점 출력 예시가 고급 표현('말씀드리겠습니다')을 씀 | 형식만 보이는 "…" 예시로 교체 | |
| 22 | api/_lib/prompts.ts:126-129 | 규칙 범위 모호 | 고급 '상사·거래처에는 하십시오체' 규칙이 롤플레이 상대역(상사)에게도 적용되는 것처럼 읽힘 | "문체는 학습자가 하는 말의 기준, 상대역은 역할에 맞는 말투" 명시 | |
| 23 | api/_lib/patterns.ts:161-165 | 원본 분산 | 어휘 목록(VOCAB)·금지 어휘가 patterns.ts와 프롬프트 글에 흩어져 있음 | level-rules.ts로 옮기고 patterns.ts는 import | |
| 24 | api/chat.ts:24, src/utils/meta.ts:75 | 옛 방식 잔재 | 첫 메시지 "[난이도: …]" 표시 방식은 더 이상 쓰지 않음 | 이전 데이터 대비 제거 로직만 유지(내부 표시 제거 함수로 흡수), 새로 붙이는 코드 없음을 확인 | |
| 25 | src/components/EmailCoach.tsx:342 | 금지 어휘 | 제목 입력 예시에 '3분기' | 중립 예시로 교체 | ✔ |
| 26 | docs/office-korean-coach-spec.md 0·9·12장 등 | 명세 불일치 | 대상 "중·고급", PRAGMATIC_GRADING_RULES 위치(prompts.ts) 등이 실제와 다름 | 마지막 단계에서 코드에 맞게 갱신 | |

- 확인했지만 문제 없음: 세종학당 BK 목록 잔재(없음), 롤플레이가 중급·고급만이라는 문장(코드·프롬프트에는 없음, 명세 0장의 대상 문구만 해당 → #26), 클라이언트 텍스트가 instructions에 들어가는 경로(없음: 표현 연습은 서버 목록 값만, 도움 요청은 input에만), 도움 캐시 키(상대역 순번+해시+종류로 적절).
- 이메일 관련 항목: 26개 중 3개(#8, #10, #25) + 일부(#15) ≈ 13% → 40% 기준 미만.
