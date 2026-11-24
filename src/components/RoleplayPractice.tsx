import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { streamChatMessage, type ChatMessage, type RoleplayLevel } from '../api/chat';
import { SCENES, type SceneCardData } from '../data/scenes';
import { cleanDisplayContent, extractNotes, shortHash, stripMetaForHistory, type ParsedNoteItem, type SupportData } from '../utils/meta';
import { addNotes } from '../utils/notesStorage';
import { FormattedMessage } from './FormattedMessage';
import { RoleplaySupportPanel, type InsertSource, type StepType } from './RoleplaySupportPanel';
import type { SupportVerdict } from '../utils/meta';
import { buildUsageBlock, emptyUsage, type SupportUsage } from '../utils/supportUsage';

interface DisplayMessage extends ChatMessage {
  id: string;
  /** API 전송용 텍스트 (없으면 content). [피드백 받기]에만 [도움 사용 기록]을 붙이고 말풍선에는 보이지 않게 함 */
  apiContent?: string;
}

const FEEDBACK_TEXT = '[피드백 요청] 대화를 마치고 피드백을 주세요.';

interface RoleplayPracticeProps {
  onStreamingChange?: (isStreaming: boolean) => void;
  onNotesSaved?: () => void;
}

export const RoleplayPractice: React.FC<RoleplayPracticeProps> = ({
  onStreamingChange,
  onNotesSaved,
}) => {
  // 단계: 'select-scene' (장면 선택) -> 'select-diff' (난이도 선택) -> 'chat' (대화 및 피드백)
  const [stage, setStage] = useState<'select-scene' | 'select-diff' | 'chat'>('select-scene');
  const [selectedScene, setSelectedScene] = useState<SceneCardData | null>(null);
  const [difficulty, setDifficulty] = useState<RoleplayLevel>('중급');

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 피드백 관련 상태
  const [feedbackNotes, setFeedbackNotes] = useState<ParsedNoteItem[]>([]);
  const [selectedNoteIndices, setSelectedNoteIndices] = useState<Set<number>>(new Set());
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // 도움 사다리 상태: 세션(장면 시작)마다 새로, 피드백 이후에는 패널 숨김
  const [sessionId, setSessionId] = useState(0);
  const [feedbackRequested, setFeedbackRequested] = useState(false);
  const usageRef = useRef<SupportUsage>(emptyUsage());
  const pendingInsertRef = useRef<{ text: string; source: InsertSource } | null>(null);
  // 도움 캐시 (키: 상대역 발화 순번 + 발화 해시 + 도움 종류). 새 턴이 되면 패널이 이전 턴 항목을 지움
  const [supportCache] = useState(() => new Map<string, SupportData>());
  // 도움 요청 직전에 읽을 최신 대화 기록 (클로저로 잡은 이전 값을 쓰지 않도록 ref로 보관)
  const supportHistoryRef = useRef<ChatMessage[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** 전송 중 표시 (상태 갱신 전에 두 번 눌러도 한 번만 보내도록 ref로 막음) */
  const sendingRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  // 1단계: 장면 카드 선택
  const handleSelectScene = (scene: SceneCardData) => {
    setSelectedScene(scene);
    setStage('select-diff');
    setErrorMessage(null);
  };

  // 2단계: 난이도 선택 후 대화 시작 (AI 첫 대사 즉시 표시)
  const handleStartRoleplay = (chosenDiff: RoleplayLevel) => {
    if (!selectedScene) return;
    setDifficulty(chosenDiff);
    setStage('chat');
    setErrorMessage(null);
    setFeedbackNotes([]);
    setSelectedNoteIndices(new Set());
    setSaveSuccessMessage(null);
    // 도움 패널·캐시·사용 기록 초기화 (패널 key가 바뀌어 새로 마운트됨)
    setSessionId((n) => n + 1);
    setFeedbackRequested(false);
    usageRef.current = emptyUsage();
    pendingInsertRef.current = null;
    supportCache.clear();

    // AI 첫 대사를 즉시 대화에 추가 (API 호출 없이 바로 표시). 초급은 짧은 첫 대사
    const firstAssistantMsg: DisplayMessage = {
      id: `ai-${Date.now()}`,
      role: 'assistant',
      content: chosenDiff === '초급' ? selectedScene.openingLineBeginner : selectedScene.firstMessage,
    };
    setMessages([firstAssistantMsg]);
  };

  const appendDelta = useCallback((msgId: string, chunk: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.id === msgId) {
        return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
      }
      return prev;
    });
  }, []);

  // 메시지 전송 로직
  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText ?? input).trim();
    if (!textToSend || isLoading || sendingRef.current || !selectedScene) return;
    sendingRef.current = true;
    const isFeedback = textToSend === FEEDBACK_TEXT;

    setErrorMessage(null);
    setSaveSuccessMessage(null);

    // 난이도는 요청 본문의 level로 보냄 (대화 기록에 "[난이도: …]"를 붙이지 않음)
    const userMessageCount = messages.filter((m) => m.role === 'user').length;
    const finalContent = textToSend;

    // 도움 사용 기록: [입력창에 넣기]로 시작한 발화인지, 보내기 전에 고쳤는지
    if (!isFeedback && pendingInsertRef.current) {
      const ins = pendingInsertRef.current;
      usageRef.current.helped.push({ index: userMessageCount + 1, source: ins.source, modified: textToSend !== ins.text.trim() });
    }
    pendingInsertRef.current = null;

    // [피드백 받기]: 전송용 텍스트에만 [도움 사용 기록]을 붙임 (말풍선과 instructions에는 넣지 않음)
    const usageBlock = isFeedback ? buildUsageBlock(usageRef.current, userMessageCount) : '';
    if (isFeedback) setFeedbackRequested(true);

    const userMessage: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: finalContent,
      ...(usageBlock ? { apiContent: finalContent + usageBlock } : {}),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    setIsLoading(true);
    onStreamingChange?.(true);

    const assistantId = `assistant-${Date.now()}`;
    const assistantPlaceholder: DisplayMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
    };
    setMessages([...newMessages, assistantPlaceholder]);
    setStreamingId(assistantId);

    try {
      // 서버 재전송용 메시지: 메타 블록을 제거한 순수 대화 기록만 전달
      const apiPayload: ChatMessage[] = newMessages.map((m) => ({
        role: m.role,
        content: stripMetaForHistory(m.apiContent ?? m.content),
      }));

      const reply = await streamChatMessage(
        apiPayload,
        (chunk) => appendDelta(assistantId, chunk),
        { mode: 'roleplay', sceneId: selectedScene.id, level: difficulty },
      );

      // 피드백 요청 메시지였거나 응답에 NOTES가 포함된 경우 노트 추출
      const extracted = extractNotes(reply);
      if (extracted.length > 0) {
        setFeedbackNotes(extracted);
        // 기본 전체 선택
        setSelectedNoteIndices(new Set(extracted.map((_, i) => i)));
      }
    } catch (error: unknown) {
      console.error('Roleplay chat error:', error);
      const msg = error instanceof Error ? error.message : '메시지 전송에 실패했습니다.';
      setErrorMessage(msg);

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.id === assistantId && last.content === '') {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      sendingRef.current = false;
      setIsLoading(false);
      setStreamingId(null);
      onStreamingChange?.(false);
    }
  };

  // 학습자가 한 번이라도 말해야 피드백 요청 가능 (발화 없이 피드백하면 없는 내용을 지어내게 됨)
  const hasUserTurn = messages.some((m) => m.role === 'user');

  // [피드백 받기] 버튼 클릭
  const handleRequestFeedback = () => {
    if (isLoading || !hasUserTurn) return;
    handleSendMessage(FEEDBACK_TEXT);
  };

  // ---------- 도움 사다리 연결 ----------
  // 상대역 발화 번호(turnIndex): 다 받은 상대역 메시지 수. 바뀌면 패널을 새로 마운트(이전 턴 도움 숨김)
  const completedAssistant = messages.filter((m) => m.role === 'assistant' && m.id !== streamingId && m.content.trim() !== '');
  const turnIndex = completedAssistant.length;
  const lastMsg = messages[messages.length - 1];
  const lastIsAssistant = !!lastMsg && lastMsg.role === 'assistant' && lastMsg.id !== streamingId && lastMsg.content.trim() !== '';
  // 도움 요청에 보낼 대화 기록: 실제 대화(학습자 말 + 상대역 말)만, 메타 블록 제거
  const supportHistory: ChatMessage[] = messages
    .filter((m) => m.id !== streamingId && m.content.trim() !== '')
    .map((m) => ({ role: m.role, content: stripMetaForHistory(m.apiContent ?? m.content) }));
  // 상대역 응답 스트리밍이 완전히 끝나고(isLoading false) 마지막 상대역 말이 비어 있지 않을 때만 패널을 보여 줌
  const showSupportPanel = stage === 'chat' && !feedbackRequested && lastIsAssistant && !isLoading;
  // 학습자가 말을 보낸 뒤 다음 상대역 발화가 끝날 때까지: 이전 턴 도움은 지우고 준비 중 안내만 보여 줌
  const showSupportWaiting = stage === 'chat' && !feedbackRequested && !showSupportPanel && isLoading && hasUserTurn;
  const supportTarget = lastIsAssistant ? stripMetaForHistory(lastMsg.content) : '';
  const supportTurnKey = `${sessionId}-${turnIndex}-${shortHash(supportTarget)}`;

  // 자식 패널의 useEffect(마운트 시 starter 요청)보다 먼저 실행되도록 layout effect에서 최신 기록을 ref에 넣음
  useLayoutEffect(() => {
    supportHistoryRef.current = supportHistory;
  });
  const getSupportHistory = useCallback(() => supportHistoryRef.current, []);

  const handleSupportInsert = (text: string, source: InsertSource) => {
    // 자동 전송하지 않음: 입력창에 넣고 포커스만 옮김
    setInput(text);
    pendingInsertRef.current = { text, source };
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      ta.style.height = 'auto';
      ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
    });
  };
  const handleSupportUse = (type: StepType) => {
    usageRef.current.counts[type] += 1;
  };
  const handleFirstChoice = (verdict: SupportVerdict) => {
    usageRef.current.firstChoices.push(verdict);
  };

  // 노트 체크박스 토글
  const handleToggleNote = (index: number) => {
    setSelectedNoteIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // 선택한 표현 노트에 저장
  const handleSaveSelectedNotes = () => {
    if (feedbackNotes.length === 0 || selectedNoteIndices.size === 0) return;

    const itemsToSave = feedbackNotes
      .filter((_, idx) => selectedNoteIndices.has(idx))
      .map((item) => ({
        source: 'roleplay' as const,
        scene: item.scene || selectedScene?.title || '상황 롤플레이',
        counterpart: item.counterpart || selectedScene?.counterpart || '상대역',
        original: item.original,
        corrected: item.corrected,
        category: item.category,
        reason: item.reason,
      }));

    const savedCount = addNotes(itemsToSave);
    setSaveSuccessMessage(`표현 노트에 ${savedCount}개 저장했어요.`);
    onNotesSaved?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 140)}px`;
  };

  return (
    <div className="roleplay-container">
      {/* 1단계: 장면 카드 선택 */}
      {stage === 'select-scene' && (
        <div className="roleplay-select-pane">
          <div className="roleplay-pane-header">
            <h3>연습할 직장 장면을 선택해 주세요</h3>
            <p>실제 사내 상황에서 상사·동료·거래처와 1:1로 대화하고 실시간 피드백을 받습니다.</p>
          </div>
          <div className="scene-card-grid">
            {SCENES.map((scene) => (
              <div
                key={scene.id}
                className="scene-card"
                onClick={() => handleSelectScene(scene)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectScene(scene);
                  }
                }}
              >
                <div className="scene-card-header">
                  <span className="scene-badge">{scene.badge}</span>
                  <span className="scene-counterpart">상대: {scene.counterpart}</span>
                </div>
                <h4 className="scene-title">{scene.title}</h4>
                <p className="scene-situation">{scene.situation}</p>
                <div className="scene-goal">
                  <strong>연습 목표:</strong> {scene.goal}
                </div>
                <div className="scene-card-footer">
                  <span className="scene-start-btn">선택하기 →</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2단계: 난이도 선택 */}
      {stage === 'select-diff' && selectedScene && (
        <div className="roleplay-diff-pane">
          <button
            type="button"
            className="quick-back-button"
            onClick={() => setStage('select-scene')}
          >
            ← 장면 다시 선택
          </button>

          <div className="diff-selected-preview">
            <span className="scene-badge">{selectedScene.badge}</span>
            <h4>{selectedScene.title}</h4>
            <p className="preview-situation">{selectedScene.situation}</p>
            <p className="preview-goal">
              <strong>목표:</strong> {selectedScene.goal} · <strong>상대:</strong> {selectedScene.counterpart}
            </p>
          </div>

          <div className="diff-prompt-box">
            <h4>난이도를 선택해 주세요</h4>
            <p>난이도에 따라 AI 상대역의 대화 속도와 어휘 수준이 조절됩니다.</p>
            <div className="diff-btn-group">
              <button
                type="button"
                className="diff-choice-btn beginner"
                onClick={() => handleStartRoleplay('초급')}
              >
                <div className="diff-title">🟢 초급</div>
                <div className="diff-desc">짧고 쉬운 해요체 대화, 문장 틀과 보기로 도움을 받으며 말하기</div>
              </button>
              <button
                type="button"
                className="diff-choice-btn medium"
                onClick={() => handleStartRoleplay('중급')}
              >
                <div className="diff-title">🟡 중급</div>
                <div className="diff-desc">짧고 명확한 사내 표현 중심, 핵심 어휘로 편안하게 대화</div>
              </button>
              <button
                type="button"
                className="diff-choice-btn advanced"
                onClick={() => handleStartRoleplay('고급')}
              >
                <div className="diff-title">🔴 고급</div>
                <div className="diff-desc">실제 한국 직장 대화 속도, 미묘한 어감과 격식 있는 비즈니스 표현</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3단계: 롤플레이 대화 및 피드백 화면 */}
      {stage === 'chat' && selectedScene && (
        <div className="roleplay-chat-pane">
          {/* 상단 고정 요약 바 */}
          <div className="roleplay-summary-bar">
            <div className="summary-left">
              <span className="summary-title">🎬 {selectedScene.title}</span>
              <span className="summary-divider">|</span>
              <span className="summary-info"><strong>상대:</strong> {selectedScene.counterpart}</span>
              <span className="summary-divider">|</span>
              <span className="summary-info"><strong>목표:</strong> {selectedScene.goal}</span>
            </div>
            <div className="summary-right">
              <span className="summary-diff-badge">{difficulty}</span>
              <button
                type="button"
                className="summary-reset-btn"
                onClick={() => setStage('select-scene')}
                disabled={isLoading}
                title="다른 장면 선택"
              >
                장면 변경
              </button>
            </div>
          </div>

          {/* 에러 알림 */}
          {errorMessage && (
            <div className="error-banner">
              <div>
                <strong>⚠️ 오류:</strong> {errorMessage}
              </div>
              <button
                type="button"
                className="error-banner-close"
                onClick={() => setErrorMessage(null)}
              >
                ✕
              </button>
            </div>
          )}

          {/* 메시지 목록 */}
          <div className="messages-container">
            {messages.map((msg) => {
              // 화면 표시 시 메타 블록([[NOTES]] 등) 숨김 처리
              const displayContent = cleanDisplayContent(msg.content);
              if (!displayContent && msg.role === 'assistant' && msg.id !== streamingId) {
                return null;
              }

              return (
                <div key={msg.id} className={`message-row ${msg.role}`}>
                  <div className="message-avatar">
                    {msg.role === 'user' ? '👤' : '🏢'}
                  </div>
                  <div className="message-bubble">
                    {msg.id === streamingId && displayContent === '' ? (
                      <span className="typing-indicator">
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                        <span className="typing-dot" />
                      </span>
                    ) : (
                      <FormattedMessage
                        content={displayContent}
                        isStreaming={msg.id === streamingId}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* 피드백에서 추출된 표현 노트 저장 체크박스 UI */}
          {feedbackNotes.length > 0 && (
            <div className="notes-save-box">
              <div className="notes-save-header">
                <strong>📝 복습 노트로 저장할 표현을 선택하세요</strong>
                <span className="notes-save-sub">선택한 표현은 '나의 표현 노트' 탭에서 복습할 수 있습니다.</span>
              </div>
              <div className="notes-checkbox-list">
                {feedbackNotes.map((item, idx) => (
                  <label key={idx} className="note-checkbox-item">
                    <input
                      type="checkbox"
                      checked={selectedNoteIndices.has(idx)}
                      onChange={() => handleToggleNote(idx)}
                    />
                    <div className="note-item-text">
                      <span className="note-category-tag">{item.category}</span>
                      <span className="note-orig">"{item.original}"</span>
                      <span className="note-arrow">→</span>
                      <span className="note-corr">"{item.corrected}"</span>
                      <div className="note-reason">{item.reason}</div>
                    </div>
                  </label>
                ))}
              </div>
              <div className="notes-save-actions">
                <button
                  type="button"
                  className="save-notes-btn"
                  onClick={handleSaveSelectedNotes}
                  disabled={selectedNoteIndices.size === 0}
                >
                  선택한 표현 노트에 저장 ({selectedNoteIndices.size}개)
                </button>
                {saveSuccessMessage && (
                  <span className="save-success-msg">✓ {saveSuccessMessage}</span>
                )}
              </div>
            </div>
          )}

          {/* 도움 사다리 패널 (입력창 바로 위). 상대역 발화마다 key가 바뀌어 새로 마운트됨 */}
          {showSupportWaiting && (
            <div className="support-panel" aria-label="도움 사다리" aria-live="polite">
              <p className="support-note">
                다음 대답을 준비하고 있어요…
                {difficulty === '초급' ? <span className="support-en-inline"> (Getting ready for the next reply…)</span> : null}
              </p>
            </div>
          )}
          {showSupportPanel && (
            <RoleplaySupportPanel
              key={supportTurnKey}
              sceneId={selectedScene.id}
              level={difficulty}
              getHistory={getSupportHistory}
              targetText={supportTarget}
              turnKey={supportTurnKey}
              cache={supportCache}
              disabled={isLoading}
              onInsert={handleSupportInsert}
              onUse={handleSupportUse}
              onFirstChoice={handleFirstChoice}
            />
          )}

          {/* 메시지 입력창 */}
          <div className="input-form-container">
            <form
              className="input-form"
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
            >
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                rows={1}
                value={input}
                onChange={handleTextareaInput}
                onKeyDown={handleKeyDown}
                placeholder={`${selectedScene.counterpart}에게 할 말을 입력하세요... (Enter 전송, Shift+Enter 줄바꿈)`}
                disabled={isLoading}
              />
              <button
                type="submit"
                className="send-button"
                disabled={isLoading || !input.trim()}
              >
                전송
              </button>
              <button
                type="button"
                className="feedback-trigger-btn"
                onClick={handleRequestFeedback}
                disabled={isLoading || !hasUserTurn}
                title="현재까지의 대화를 바탕으로 피드백을 받습니다."
              >
                피드백 받기
              </button>
            </form>
            <div className="input-hint">
              <span>대화 중 질문이나 도움이 필요하면 영어로 묻거나 "(도움말)"을 요청할 수 있습니다.</span>
              <span>대화가 끝나면 <strong>[피드백 받기]</strong>를 눌러 표현과 보고 순서 피드백을 받으세요.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleplayPractice;
