import React, { useState, useRef, useEffect, useCallback } from 'react';
import { streamChatMessage, type ChatMessage } from '../api/chat';
import { cleanDisplayContent, extractNotes, stripMetaForHistory, type ParsedNoteItem } from '../utils/meta';
import { addNotes } from '../utils/notesStorage';
import { FormattedMessage } from './FormattedMessage';

interface DisplayMessage extends ChatMessage {
  id: string;
}

interface EmailCoachProps {
  onStreamingChange?: (isStreaming: boolean) => void;
  onNotesSaved?: () => void;
}

const RECIPIENT_OPTIONS = [
  '팀장(상사)',
  '같은 팀 동료',
  '다른 부서 동료',
  '거래처 담당자',
  '고객',
] as const;

const PURPOSE_OPTIONS = [
  '요청',
  '일정 변경·연기',
  '사과',
  '보고',
  '감사',
  '거절',
] as const;

export const EmailCoach: React.FC<EmailCoachProps> = ({
  onStreamingChange,
  onNotesSaved,
}) => {
  // 폼 입력 상태
  const [recipient, setRecipient] = useState<string>('팀장(상사)');
  const [purpose, setPurpose] = useState<string>('요청');
  const [memo, setMemo] = useState<string>('');
  const [subject, setSubject] = useState<string>('');
  const [body, setBody] = useState<string>('');

  // 대화 및 첨삭 결과 상태
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [followUpInput, setFollowUpInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 피드백 노트 상태
  const [feedbackNotes, setFeedbackNotes] = useState<ParsedNoteItem[]>([]);
  const [selectedNoteIndices, setSelectedNoteIndices] = useState<Set<number>>(new Set());
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // 첨삭 완료 여부 (결과가 나온 뒤에는 추가 질문 모드로 전환)
  const [hasSubmitted, setHasSubmitted] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleResetAll = useCallback(() => {
    if (isLoading) return;
    setRecipient('팀장(상사)');
    setPurpose('요청');
    setMemo('');
    setSubject('');
    setBody('');
    setMessages([]);
    setFollowUpInput('');
    setErrorMessage(null);
    setFeedbackNotes([]);
    setSelectedNoteIndices(new Set());
    setSaveSuccessMessage(null);
    setHasSubmitted(false);
    onStreamingChange?.(false);
  }, [isLoading, onStreamingChange]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const appendDelta = useCallback((msgId: string, chunk: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.id === msgId) {
        return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
      }
      return prev;
    });
  }, []);

  // [첨삭 받기] 실행
  const handleSubmitEmail = async () => {
    const trimmedBody = body.trim();
    if (!trimmedBody || isLoading) return;

    setErrorMessage(null);
    setSaveSuccessMessage(null);

    const emailRequestText = `[이메일 첨삭 요청]
받는 사람: ${recipient}
목적: ${purpose}
상황 메모: ${memo.trim() || '(없음)'}
제목: ${subject.trim() || '(제목 없음)'}
본문:
${trimmedBody}`;

    const userMessage: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: emailRequestText,
    };

    setMessages([userMessage]);
    setHasSubmitted(true);
    setIsLoading(true);
    onStreamingChange?.(true);

    const assistantId = `assistant-${Date.now()}`;
    const assistantPlaceholder: DisplayMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
    };
    setMessages([userMessage, assistantPlaceholder]);
    setStreamingId(assistantId);

    let receivedAny = false;
    try {
      const apiPayload: ChatMessage[] = [
        { role: 'user', content: emailRequestText },
      ];

      const reply = await streamChatMessage(
        apiPayload,
        (chunk) => {
          receivedAny = true;
          appendDelta(assistantId, chunk);
        },
        { mode: 'email' },
      );

      const notes = extractNotes(reply);
      if (notes.length > 0) {
        setFeedbackNotes(notes);
        setSelectedNoteIndices(new Set(notes.map((_, i) => i)));
      }
    } catch (error: unknown) {
      console.error('Email coach error:', error);
      const msg = error instanceof Error ? error.message : '이메일 첨삭 요청에 실패했습니다.';
      setErrorMessage(msg);

      if (!receivedAny) {
        // 응답을 하나도 받지 못했으면 작성 내용을 유지한 채 폼으로 돌아가 다시 시도할 수 있게 함
        setMessages([]);
        setHasSubmitted(false);
      }
    } finally {
      setIsLoading(false);
      setStreamingId(null);
      onStreamingChange?.(false);
    }
  };

  // 추가 질문 전송
  const handleSendFollowUp = async () => {
    const trimmed = followUpInput.trim();
    if (!trimmed || isLoading) return;

    setErrorMessage(null);

    const userMsg: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setFollowUpInput('');

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
      const apiPayload: ChatMessage[] = newMessages.map((m) => ({
        role: m.role,
        content: stripMetaForHistory(m.content),
      }));

      const reply = await streamChatMessage(
        apiPayload,
        (chunk) => appendDelta(assistantId, chunk),
        { mode: 'email' },
      );

      const notes = extractNotes(reply);
      if (notes.length > 0) {
        // 새 노트의 체크박스 번호는 기존 노트 개수 뒤에서 시작 (선택 개수 기준이 아님)
        const baseIndex = feedbackNotes.length;
        setFeedbackNotes((prev) => [...prev, ...notes]);
        setSelectedNoteIndices((prev) => {
          const next = new Set(prev);
          notes.forEach((_, idx) => next.add(baseIndex + idx));
          return next;
        });
      }
    } catch (error: unknown) {
      console.error('Follow-up error:', error);
      const msg = error instanceof Error ? error.message : '답변을 불러오지 못했습니다.';
      setErrorMessage(msg);

      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.id === assistantId && last.content === '') {
          return prev.slice(0, -1);
        }
        return prev;
      });
    } finally {
      setIsLoading(false);
      setStreamingId(null);
      onStreamingChange?.(false);
    }
  };

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

  const handleSaveSelectedNotes = () => {
    if (feedbackNotes.length === 0 || selectedNoteIndices.size === 0) return;

    const itemsToSave = feedbackNotes
      .filter((_, idx) => selectedNoteIndices.has(idx))
      .map((item) => ({
        source: 'email' as const,
        scene: '이메일 첨삭',
        counterpart: item.counterpart || recipient,
        original: item.original,
        corrected: item.corrected,
        category: item.category,
        reason: item.reason,
      }));

    const savedCount = addNotes(itemsToSave);
    setSaveSuccessMessage(`표현 노트에 ${savedCount}개 저장했어요.`);
    onNotesSaved?.();
  };

  return (
    <div className="email-coach-container">
      {/* 첨삭 전: 이메일 작성 폼 */}
      {!hasSubmitted ? (
        <div className="email-form-pane">
          <div className="email-form-header">
            <h3>✉️ 비즈니스 이메일 작성 & 첨삭</h3>
            <p>
              받는 사람과 목적에 맞춰 높임법, 완곡 표현, 결론 먼저 쓰기를 점검하고 정중한 모범 문장으로 첨삭해 드립니다.
            </p>
          </div>

          <div className="email-field-row">
            <div className="email-field-col">
              <label className="email-field-label">받는 사람</label>
              <select
                className="email-select"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
              >
                {RECIPIENT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>

            <div className="email-field-col">
              <label className="email-field-label">작성 목적</label>
              <select
                className="email-select"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
              >
                {PURPOSE_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="email-field-group">
            <label className="email-field-label">
              상황 메모 <span className="label-sub">(선택, 100자 이내)</span>
            </label>
            <input
              type="text"
              className="email-text-input"
              maxLength={100}
              placeholder="예: 내일 회의 자료를 급하게 요청해야 하는 상황"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
          </div>

          <div className="email-field-group">
            <label className="email-field-label">
              이메일 제목 <span className="label-sub">(선택)</span>
            </label>
            <input
              type="text"
              className="email-text-input"
              placeholder="예: [요청] 3분기 예산안 자료 송부 부탁드립니다"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </div>

          <div className="email-field-group">
            <div className="label-with-counter">
              <label className="email-field-label">
                이메일 본문 <span className="label-required">*필수</span>
              </label>
              <span className={`char-counter ${body.length > 2000 ? 'over' : ''}`}>
                {body.length} / 2,000자
              </span>
            </div>
            <textarea
              className="email-body-textarea"
              rows={8}
              maxLength={2000}
              placeholder="작성하신 이메일 본문을 입력해 주세요. 높임법, 완곡한 표현, 결론 중심의 보고 구조를 분석해 드립니다."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          {errorMessage && (
            <div className="error-banner">
              <div>
                <strong>⚠️ 오류:</strong> {errorMessage}
              </div>
            </div>
          )}

          <div className="email-submit-actions">
            <button
              type="button"
              className="email-submit-btn"
              onClick={handleSubmitEmail}
              disabled={isLoading || !body.trim() || body.length > 2000}
            >
              {isLoading ? '첨삭 분석 중...' : '이메일 첨삭 받기 →'}
            </button>
          </div>
        </div>
      ) : (
        /* 첨삭 후: 결과 및 추가 질문 뷰 */
        <div className="email-result-pane">
          <div className="email-result-header">
            <div className="result-header-info">
              <span className="email-badge">이메일 첨삭</span>
              <strong>받는 사람:</strong> {recipient} · <strong>목적:</strong> {purpose}
            </div>
            <button
              type="button"
              className="reset-button small"
              onClick={handleResetAll}
              disabled={isLoading}
            >
              ✏️ 새 이메일 쓰기
            </button>
          </div>

          {errorMessage && (
            <div className="error-banner">
              <div>
                <strong>⚠️ 오류:</strong> {errorMessage}
              </div>
            </div>
          )}

          <div className="messages-container email-messages">
            {messages.map((msg) => {
              const displayContent = cleanDisplayContent(msg.content);
              if (!displayContent && msg.role === 'assistant' && msg.id !== streamingId) {
                return null;
              }

              return (
                <div key={msg.id} className={`message-row ${msg.role}`}>
                  <div className="message-avatar">
                    {msg.role === 'user' ? '👤' : '✉️'}
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

          {/* 노트 저장 UI */}
          {feedbackNotes.length > 0 && (
            <div className="notes-save-box">
              <div className="notes-save-header">
                <strong>📝 복습 노트로 저장할 첨삭 표현</strong>
                <span className="notes-save-sub">나의 표현 노트에 저장하고 주기적으로 복습할 수 있습니다.</span>
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

          {/* 추가 질문 입력창 */}
          <div className="input-form-container">
            <form
              className="input-form"
              onSubmit={(e) => {
                e.preventDefault();
                handleSendFollowUp();
              }}
            >
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                rows={1}
                value={followUpInput}
                onChange={(e) => setFollowUpInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendFollowUp();
                  }
                }}
                placeholder="첨삭 결과에 대해 더 궁금한 점을 물어보세요... (예: 왜 '번거로우시겠지만'을 앞에 써요?)"
                disabled={isLoading}
              />
              <button
                type="submit"
                className="send-button"
                disabled={isLoading || !followUpInput.trim()}
              >
                질문하기
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailCoach;
