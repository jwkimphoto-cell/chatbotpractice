import React, { useState, useCallback, useRef } from 'react';
import { streamChatMessage, type ChatMessage } from '../api/chat';
import {
  cleanDisplayContent,
  extractResult,
  isPassingVerdict,
  type NoteCategory,
  type ParsedResult,
  type ReviewVerdict,
} from '../utils/meta';
import {
  loadNotes,
  deleteNote,
  recordReviewResult,
  getDueCards,
  cardLevel,
  type NoteCard,
} from '../utils/notesStorage';
import { FormattedMessage } from './FormattedMessage';

interface ExpressionNotesProps {
  /** 노트 탭이 화면에 보이는지 여부 (보일 때마다 localStorage에서 목록을 다시 읽음) */
  isActive?: boolean;
  onStreamingChange?: (isStreaming: boolean) => void;
  onNavigateTab?: (tabKey: 'expression' | 'roleplay' | 'email') => void;
  onNotesCountChange?: (count: number) => void;
}

const SOURCE_LABELS = {
  전체: '전체',
  expression: '표현 연습',
  roleplay: '롤플레이',
  email: '이메일',
} as const;

export const ExpressionNotes: React.FC<ExpressionNotesProps> = ({
  isActive = false,
  onStreamingChange,
  onNavigateTab,
  onNotesCountChange,
}) => {
  const [notes, setNotes] = useState<NoteCard[]>(() => loadNotes());
  const [sourceFilter, setSourceFilter] = useState<'전체' | 'roleplay' | 'email' | 'expression'>('전체');
  const [categoryFilter, setCategoryFilter] = useState<'전체' | NoteCategory>('전체');

  // 인라인 삭제 확인 상태
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // 복습 퀴즈 모드 상태
  const [isReviewMode, setIsReviewMode] = useState<boolean>(false);
  const [reviewCards, setReviewCards] = useState<NoteCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [userAnswer, setUserAnswer] = useState<string>('');

  // 퀴즈 채점 상태
  const [isGrading, setIsGrading] = useState<boolean>(false);
  const [gradeResponse, setGradeResponse] = useState<string>('');
  const [gradeResultObj, setGradeResultObj] = useState<ParsedResult | null>(null);
  const [isSelfGradeMode, setIsSelfGradeMode] = useState<boolean>(false);
  const [isAnswerRevealed, setIsAnswerRevealed] = useState<boolean>(false);

  // 세션 결과 통계
  const [sessionResults, setSessionResults] = useState<ReviewVerdict[]>([]);
  /** 채점 요청 중 표시 (상태 갱신 전에 Enter를 두 번 눌러도 한 번만 보내도록 ref로 막음) */
  const gradingRef = useRef(false);
  const [isSessionFinished, setIsSessionFinished] = useState<boolean>(false);

  const refreshNotes = useCallback(() => {
    const list = loadNotes();
    setNotes(list);
    const due = getDueCards().length;
    onNotesCountChange?.(due);
  }, [onNotesCountChange]);

  // 다른 탭(롤플레이·이메일)에서 저장한 카드가 바로 보이도록, 탭이 열릴 때마다 목록 갱신
  // (●N 배지는 App의 탭 전환 핸들러가 갱신)
  const [wasActive, setWasActive] = useState(isActive);
  if (isActive !== wasActive) {
    setWasActive(isActive);
    if (isActive) setNotes(loadNotes());
  }

  const totalCount = notes.length;
  const dueCount = getDueCards().length;

  // 필터링된 노트 목록
  const filteredNotes = notes.filter((card) => {
    if (sourceFilter !== '전체' && card.source !== sourceFilter) return false;
    if (categoryFilter !== '전체' && card.category !== categoryFilter) return false;
    return true;
  });

  // 복습 시작 (오늘 복습 또는 전체 복습)
  const handleStartReview = (type: 'due' | 'all') => {
    const targetCards = type === 'due' ? getDueCards() : [...notes];
    if (targetCards.length === 0) return;

    setReviewCards(targetCards);
    setCurrentIndex(0);
    setUserAnswer('');
    setGradeResponse('');
    setGradeResultObj(null);
    setIsSelfGradeMode(false);
    setIsAnswerRevealed(false);
    setSessionResults([]);
    setIsSessionFinished(false);
    setIsReviewMode(true);
  };

  const currentCard = reviewCards[currentIndex];

  // 퀴즈 제출 (mode: 'review'로 API 호출)
  const handleSubmitAnswer = async () => {
    if (!userAnswer.trim() || isGrading || gradingRef.current || !currentCard) return;
    gradingRef.current = true;

    setIsGrading(true);
    setGradeResponse('');
    setGradeResultObj(null);
    setIsSelfGradeMode(false);
    setIsAnswerRevealed(false);
    onStreamingChange?.(true);

    const reviewPrompt = `[복습 채점 요청]
장면: ${currentCard.scene} / 상대: ${currentCard.counterpart} / 난이도: ${cardLevel(currentCard)} / 원래 표현: ${currentCard.original} / 모범 표현: ${currentCard.corrected} / 범주: ${currentCard.category} / 학습자 답: ${userAnswer.trim()}`;

    const apiPayload: ChatMessage[] = [{ role: 'user', content: reviewPrompt }];

    try {
      let accumulated = '';
      const reply = await streamChatMessage(
        apiPayload,
        (chunk) => {
          accumulated += chunk;
          setGradeResponse(accumulated);
        },
        { mode: 'review' },
      );

      const result = extractResult(reply);
      if (result) {
        setGradeResultObj(result);
        recordReviewResult(currentCard.id, result.verdict);
        setSessionResults((prev) => [...prev, result.verdict]);
        refreshNotes();
      } else {
        // RESULT 파싱 실패 시 자기 채점 폴백 모드 전환
        setIsSelfGradeMode(true);
      }
    } catch (err) {
      console.error('Review grader error:', err);
      // API 오류 시 자기 채점 폴백 모드
      setIsSelfGradeMode(true);
      setGradeResponse('채점 서버와 연결할 수 없습니다. 모범 표현을 확인하고 직접 채점해 보세요.');
    } finally {
      gradingRef.current = false;
      setIsGrading(false);
      onStreamingChange?.(false);
    }
  };

  // 자기 채점 버튼 핸들러 (맞혔어요=alternative / 거의 맞혔어요=partial / 다시 볼래요=incorrect)
  const handleSelfGrade = (verdict: ReviewVerdict) => {
    if (!currentCard) return;
    recordReviewResult(currentCard.id, verdict);
    setSessionResults((prev) => [...prev, verdict]);
    setGradeResultObj({ verdict, correct: isPassingVerdict(verdict) });
    refreshNotes();
  };

  // 세션 요약: 정답(두 종류의 ✅ 합산) · 부분 정답 · 오답
  const passedCount = sessionResults.filter(isPassingVerdict).length;
  const partialCount = sessionResults.filter((v) => v === 'partial').length;
  const incorrectCount = sessionResults.filter((v) => v === 'incorrect').length;

  // 다음 카드 이동
  const handleNextCard = () => {
    if (currentIndex + 1 < reviewCards.length) {
      setCurrentIndex((prev) => prev + 1);
      setUserAnswer('');
      setGradeResponse('');
      setGradeResultObj(null);
      setIsSelfGradeMode(false);
      setIsAnswerRevealed(false);
    } else {
      setIsSessionFinished(true);
    }
  };

  // 인라인 삭제
  const handleDeleteCard = (id: string) => {
    deleteNote(id);
    setDeleteConfirmId(null);
    refreshNotes();
  };

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return `${d.getMonth() + 1}월 ${d.getDate()}일`;
    } catch {
      return isoStr;
    }
  };

  // 세션 종료 후 다음 복습일 계산 (이번에 복습한 카드들 중 가장 빠른 다음 복습일)
  const getNextEarliestReviewDate = () => {
    const reviewedIds = new Set(reviewCards.map((c) => c.id));
    const list = loadNotes().filter((c) => reviewedIds.has(c.id));
    if (list.length === 0) return '없음';
    const dates = list.map((c) => new Date(c.nextReviewAt).getTime()).sort((a, b) => a - b);
    return formatDate(new Date(dates[0]).toISOString());
  };

  return (
    <div className="notes-container">
      {/* 퀴즈 모드 화면 */}
      {isReviewMode ? (
        <div className="review-quiz-pane">
          <div className="review-quiz-header">
            <span className="quiz-progress-badge">
              복습 카드 ({currentIndex + 1} / {reviewCards.length})
            </span>
            <button
              type="button"
              className="reset-button small"
              onClick={() => {
                setIsReviewMode(false);
                refreshNotes();
              }}
            >
              ✕ 복습 종료
            </button>
          </div>

          {!isSessionFinished && currentCard ? (
            <div className="quiz-card-box">
              <div className="quiz-scene-info">
                <strong>상황:</strong> {currentCard.scene} · <strong>상대:</strong> {currentCard.counterpart} · <strong>난이도:</strong> {cardLevel(currentCard)}
              </div>

              <div className="quiz-question-box">
                <div className="quiz-q-title">Q. 아래 표현을 상황에 더 알맞게 고쳐 써 보세요.</div>
                <div className="quiz-original-quote">"{currentCard.original}"</div>
                <div className="quiz-hint-text">
                  💡 <strong>힌트:</strong> {currentCard.category}을(를) 생각해 보세요.
                </div>
                <div className="quiz-q-title">답을 입력해 보세요.</div>
              </div>

              {/* 답변 입력창 및 제출 버튼 */}
              {!gradeResultObj && !isSelfGradeMode && (
                <div className="quiz-input-area">
                  <input
                    type="text"
                    className="quiz-text-input"
                    placeholder="상황에 맞는 모범 표현을 입력해 보세요."
                    value={userAnswer}
                    onChange={(e) => setUserAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      // 한글 IME 조합 중 Enter로 덜 입력된 답이 제출되지 않도록 방지
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === 'Enter') {
                        handleSubmitAnswer();
                      }
                    }}
                    disabled={isGrading}
                  />
                  <button
                    type="button"
                    className="quiz-submit-btn"
                    onClick={handleSubmitAnswer}
                    disabled={isGrading || !userAnswer.trim()}
                  >
                    {isGrading ? '채점 중...' : '제출하기'}
                  </button>
                </div>
              )}

              {/* 채점 결과 표시 */}
              {gradeResponse && (
                <div className="quiz-feedback-box">
                  <FormattedMessage content={cleanDisplayContent(gradeResponse)} />
                </div>
              )}

              {/* 자기 채점 폴백 UI (API 실패 또는 RESULT 누락 시) */}
              {isSelfGradeMode && !gradeResultObj && (
                <div className="self-grade-box">
                  {!isAnswerRevealed ? (
                    <button
                      type="button"
                      className="reveal-answer-btn"
                      onClick={() => setIsAnswerRevealed(true)}
                    >
                      정답 보기
                    </button>
                  ) : (
                    <div className="revealed-answer-area">
                      <div className="revealed-model-text">
                        <strong>모범 표현:</strong> {currentCard.corrected}
                      </div>
                      <div className="revealed-reason-text">{currentCard.reason}</div>
                      <div className="self-grade-actions">
                        <span>직접 채점해 주세요:</span>
                        <button
                          type="button"
                          className="self-grade-btn correct"
                          onClick={() => handleSelfGrade('alternative')}
                        >
                          ✓ 맞혔어요
                        </button>
                        <button
                          type="button"
                          className="self-grade-btn partial"
                          onClick={() => handleSelfGrade('partial')}
                        >
                          △ 거의 맞혔어요
                        </button>
                        <button
                          type="button"
                          className="self-grade-btn incorrect"
                          onClick={() => handleSelfGrade('incorrect')}
                        >
                          ✕ 다시 볼래요
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 채점 완료 후 [다음 카드] 버튼 */}
              {gradeResultObj && (
                <div className="quiz-next-actions">
                  <button type="button" className="quiz-next-btn" onClick={handleNextCard}>
                    {currentIndex + 1 < reviewCards.length ? '다음 카드 →' : '결과 확인하기 →'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* 세션 완료 요약 화면 */
            <div className="quiz-summary-box">
              <div className="quiz-finish-icon">🎉</div>
              <h3>오늘의 복습을 모두 완료했습니다!</h3>
              <div className="session-stat-card">
                <div className="stat-highlight">
                  <span>{reviewCards.length}장 중 정답 </span>
                  <strong className="correct-count">{passedCount}</strong>
                  <span> · 부분 정답 {partialCount} · 오답 {incorrectCount}</span>
                </div>
                <div className="stat-next-date">다음 복습: {getNextEarliestReviewDate()}</div>
              </div>
              <p className="summary-desc">
                맞힌 카드는 더 긴 간격 뒤에, 부분 정답·오답 카드는 내일 다시 등장합니다.
              </p>
              <button
                type="button"
                className="back-to-notes-btn"
                onClick={() => {
                  setIsReviewMode(false);
                  refreshNotes();
                }}
              >
                노트 목록으로 돌아가기
              </button>
            </div>
          )}
        </div>
      ) : (
        /* 기본 노트 목록 화면 */
        <div className="notes-list-pane">
          {/* 상단 요약 바 */}
          <div className="notes-summary-bar">
            <div className="notes-count-info">
              전체 카드 <strong>{totalCount}</strong>장 · 오늘 복습 <strong>{dueCount}</strong>장
            </div>
            <div className="notes-review-actions">
              <button
                type="button"
                className="review-start-btn due"
                onClick={() => handleStartReview('due')}
                disabled={dueCount === 0}
              >
                오늘 복습 시작 ({dueCount})
              </button>
              <button
                type="button"
                className="review-start-btn all"
                onClick={() => handleStartReview('all')}
                disabled={totalCount === 0}
              >
                전체 복습
              </button>
            </div>
          </div>

          {/* 필터 바 */}
          <div className="notes-filter-bar">
            <div className="filter-group">
              <span className="filter-label">출처:</span>
              {(['전체', 'expression', 'roleplay', 'email'] as const).map((src) => (
                <button
                  key={src}
                  type="button"
                  className={`filter-chip ${sourceFilter === src ? 'active' : ''}`}
                  onClick={() => setSourceFilter(src)}
                >
                  {SOURCE_LABELS[src]}
                </button>
              ))}
            </div>

            <div className="filter-group">
              <span className="filter-label">범주:</span>
              {(['전체', '높임법', '완곡 표현', '보고 순서', '어휘·문법'] as const).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  className={`filter-chip ${categoryFilter === cat ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* 카드 목록 */}
          {filteredNotes.length > 0 ? (
            <div className="notes-grid">
              {filteredNotes.map((card) => (
                <div key={card.id} className="note-card">
                  <div className="card-top-row">
                    <span className="card-scene-title">
                      {card.scene} · {card.counterpart}
                    </span>
                    <div className="card-tags">
                      <span className="card-cat-badge">{card.category}</span>
                      <span className="card-box-badge">Box {card.box}</span>
                    </div>
                  </div>

                  <div className="card-expr-compare">
                    <div className="expr-row original">
                      <span className="expr-label">내 표현:</span>
                      <span className="expr-text">{card.original}</span>
                    </div>
                    <div className="expr-row corrected">
                      <span className="expr-label">고친 표현:</span>
                      <strong className="expr-text">{card.corrected}</strong>
                    </div>
                  </div>

                  <div className="card-reason">{card.reason}</div>

                  <div className="card-bottom-row">
                    <span className="card-review-date">
                      다음 복습: {formatDate(card.nextReviewAt)} (복습 {card.reviewCount}회)
                    </span>

                    {/* 인라인 삭제 확인 */}
                    {deleteConfirmId === card.id ? (
                      <span className="inline-delete-confirm">
                        정말 삭제할까요?
                        <button
                          type="button"
                          className="confirm-yes-btn"
                          onClick={() => handleDeleteCard(card.id)}
                        >
                          삭제
                        </button>
                        <button
                          type="button"
                          className="confirm-no-btn"
                          onClick={() => setDeleteConfirmId(null)}
                        >
                          취소
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="card-delete-btn"
                        onClick={() => setDeleteConfirmId(card.id)}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : totalCount > 0 ? (
            /* 카드는 있지만 필터 조건에 맞는 카드가 없을 때 */
            <div className="notes-empty-box">
              <h4>조건에 맞는 카드가 없습니다.</h4>
              <p>출처나 범주 필터를 바꿔 보세요.</p>
            </div>
          ) : (
            /* 카드가 없을 때 안내 */
            <div className="notes-empty-box">
              <div className="empty-icon">📂</div>
              <h4>저장된 표현 카드가 없습니다.</h4>
              <p>
                상황 롤플레이나 이메일 첨삭에서 피드백을 받은 뒤 유용한 비즈니스 표현을 노트에 저장해 보세요.
              </p>
              <div className="empty-nav-buttons">
                <button
                  type="button"
                  className="empty-nav-btn"
                  onClick={() => onNavigateTab?.('roleplay')}
                >
                  🎭 상황 롤플레이로 이동
                </button>
                <button
                  type="button"
                  className="empty-nav-btn"
                  onClick={() => onNavigateTab?.('email')}
                >
                  ✉️ 이메일 첨삭으로 이동
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ExpressionNotes;
