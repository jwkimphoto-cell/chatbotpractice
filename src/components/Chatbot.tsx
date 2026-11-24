import React, { useState, useRef, useEffect, useCallback } from 'react';
import { streamChatMessage, type ChatMessage } from '../api/chat';
import { FormattedMessage } from './FormattedMessage';
import { NotesSaveBox } from './NotesSaveBox';
import {
  cleanDisplayContent,
  collapseRepeatedReply,
  extractNotes,
  keepLastIntroSet,
  stripSourceTags,
  type ParsedNoteItem,
} from '../utils/meta';
import { addNotes } from '../utils/notesStorage';
import { buildExpressionPayload, expressionLevel } from '../utils/chatState';
import {
  EMPTY_HISTORY,
  buildHistoryBlock,
  isHistoryCommand,
  mergeHistory,
  type ExpressionHistory,
} from '../utils/expressionHistory';
import './Chatbot.css';

interface DisplayMessage extends ChatMessage {
  id: string;
  /**
   * API 전송용 텍스트. 없으면 content를 그대로 보냄.
   * "다른 표현"/"퀴즈 시작"은 화면에는 누른 문구만 보이고(content), 전송용에만 [이미 소개한 문형] 블록을 붙임.
   * 이후 대화 기록을 다시 보낼 때도 이 값을 씀.
   */
  apiContent?: string;
}

interface ChatbotProps {
  hideHeader?: boolean;
  onStreamingChange?: (isStreaming: boolean) => void;
  onNotesSaved?: () => void;
}

const INITIAL_GREETING = `안녕하세요! 외국인 직장인을 위한 직장 한국어 연습 도우미입니다. 💼
회의, 보고, 이메일 등 다양한 직장 상황에서 꼭 필요한 한국어 표현을 배우고 빈칸 채우기 퀴즈로 복습해 보세요.

연습하고 싶으신 **주제**와 **난이도(초급/중급/고급)**를 선택하시거나 직접 입력해 주시면 표현 3가지를 소개해 드립니다!`;

/** 1단계: 주제 선택 목록 */
const TOPIC_OPTIONS = [
  { label: '📊 보고', value: '보고' },
  { label: '📧 이메일', value: '이메일' },
  { label: '🤝 회의', value: '회의' },
];

/** 첫 표현 소개 이후 입력창 위에 보이는 빠른 응답 (누르면 명령어를 그대로 전송) */
const QUICK_REPLIES = [
  { label: '📝 퀴즈 시작', value: '퀴즈 시작' },
  { label: '➕ 다른 표현 더 보기', value: '다른 표현' },
];

/** 2단계: 난이도 선택 목록 */
const DIFFICULTY_OPTIONS = [
  { label: '🟢 초급', value: '초급' },
  { label: '🟡 중급', value: '중급' },
  { label: '🔴 고급', value: '고급' },
];

export const Chatbot: React.FC<ChatbotProps> = ({
  hideHeader = false,
  onStreamingChange,
  onNotesSaved,
}) => {
  const [messages, setMessages] = useState<DisplayMessage[]>([
    {
      id: 'init-msg',
      role: 'assistant',
      content: INITIAL_GREETING,
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** 스트리밍 중인 어시스턴트 메시지의 id (없으면 스트리밍 아님) */
  const [streamingId, setStreamingId] = useState<string | null>(null);

  /** 2단계 추천 선택 상태: 선택된 주제 (null이면 1단계=주제 선택) */
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);

  /** 채점이 🟡/❌일 때 응답 끝 [[NOTES]]에서 추출한 표현 노트 후보 */
  const [feedbackNotes, setFeedbackNotes] = useState<ParsedNoteItem[]>([]);
  const [selectedNoteIndices, setSelectedNoteIndices] = useState<Set<number>>(new Set());
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  /** 이미 소개한 문형·대표 문장 (표현 소개 응답이 끝날 때마다 코드가 직접 누적) */
  const [introHistory, setIntroHistory] = useState<ExpressionHistory>(EMPTY_HISTORY);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** 전송 중 표시 (상태 갱신 전에 두 번 눌러도 한 번만 보내도록 ref로 막음) */
  const sendingRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleReset = useCallback(() => {
    if (isLoading) return;
    setMessages([
      {
        id: `init-${Date.now()}`,
        role: 'assistant',
        content: INITIAL_GREETING,
      },
    ]);
    setErrorMessage(null);
    setInput('');
    setSelectedTopic(null);
    setFeedbackNotes([]);
    setSelectedNoteIndices(new Set());
    setSaveSuccessMessage(null);
    setIntroHistory(EMPTY_HISTORY);
  }, [isLoading]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  /**
   * 스트리밍 중인 어시스턴트 메시지의 content를 실시간 업데이트하는 콜백.
   * messages 배열의 마지막 항목(streamingId와 일치)에 텍스트를 누적한다.
   */
  const appendDelta = useCallback((msgId: string, chunk: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.id === msgId) {
        // 마지막 메시지만 업데이트 — 나머지는 참조 유지
        return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
      }
      return prev;
    });
  }, []);

  const handleSendMessage = async (textToSend?: string) => {
    const trimmed = (textToSend ?? input).trim();
    if (!trimmed || isLoading || sendingRef.current) return;
    sendingRef.current = true;

    setErrorMessage(null);
    setSaveSuccessMessage(null);
    // 이전 채점의 노트 저장 후보는 새 메시지를 보내면 지움 (다음 응답과 섞여 보이지 않게)
    setFeedbackNotes([]);
    setSelectedNoteIndices(new Set());

    // "다른 표현"/"퀴즈 시작"이면 전송용 텍스트에만 이미 소개한 문형·대표 문장 블록을 붙임
    const historyBlock = isHistoryCommand(trimmed) ? buildHistoryBlock(introHistory) : '';
    const userMessage: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      ...(historyBlock ? { apiContent: trimmed + historyBlock } : {}),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    setIsLoading(true);
    onStreamingChange?.(true);

    // 빈 어시스턴트 메시지를 미리 추가 (여기에 스트리밍 텍스트가 채워짐)
    const assistantId = `assistant-${Date.now()}`;
    const assistantPlaceholder: DisplayMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
    };
    const messagesWithPlaceholder = [...newMessages, assistantPlaceholder];
    setMessages(messagesWithPlaceholder);
    setStreamingId(assistantId);

    try {
      // API 전송용 메시지 목록 (role과 전송용 텍스트만 전달, placeholder 제외, 메타 블록 제거)
      const apiPayload = buildExpressionPayload(newMessages);

      const rawReply = await streamChatMessage(apiPayload, (chunk) => {
        appendDelta(assistantId, chunk);
      });

      // 응답이 두 번 이어 붙어 나왔으면 한 번만 남김 (화면과 이후 대화 기록 모두)
      // ① 완전히 같은 두 판 → 한 번 ② 세트 제목이 두 번(초안 + 고친 판) → 마지막 판만
      const reply = keepLastIntroSet(collapseRepeatedReply(rawReply));
      if (reply !== rawReply) {
        console.warn('[Chatbot] 응답이 두 번 이어 붙어 와서 한 판만 남겼습니다.');
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: reply } : m)));
      }

      // 표현 소개 응답이면 문형·대표 문장을 기록에 누적 (다른 응답은 그대로)
      setIntroHistory((prev) => mergeHistory(prev, reply));

      // 🟡 부분 정답·❌ 오답 채점에만 붙는 [[NOTES]] → 저장 후보로 표시 (자동 저장 안 함)
      const extracted = extractNotes(reply);
      if (extracted.length > 0) {
        setFeedbackNotes(extracted);
        setSelectedNoteIndices(new Set()); // 처음에는 모두 비워 둠 (학습자가 고르거나 [전체 선택])
      }
    } catch (error: unknown) {
      console.error('Chat error:', error);
      const msg = error instanceof Error ? error.message : '메시지 전송에 실패했습니다.';
      setErrorMessage(msg);

      // 스트리밍 중 에러 발생 시, 빈 placeholder가 남아있으면 제거
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 한글 조합 중 Enter 이벤트 중복 방지
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

  /** 1단계: 주제 선택 */
  const handleTopicSelect = (topicValue: string) => {
    if (isLoading) return;
    setSelectedTopic(topicValue);
  };

  /** 2단계: 난이도 선택 → 메시지 전송 */
  const handleDifficultySelect = (difficultyValue: string) => {
    if (isLoading || !selectedTopic) return;
    const prompt = `주제: ${selectedTopic}\n난이도: ${difficultyValue}\n위 조건에 맞는 직장 한국어 표현 연습을 시작해줘.`;
    setSelectedTopic(null);
    // 주제·난이도를 새로 고르면 이미 소개한 문형 기록을 비움
    setIntroHistory(EMPTY_HISTORY);
    handleSendMessage(prompt);
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
        source: 'expression' as const,
        level: expressionLevel(messages),
        scene: item.scene || '표현 연습',
        counterpart: item.counterpart || '상대',
        original: item.original,
        corrected: item.corrected,
        category: item.category,
        reason: item.reason,
      }));
    const savedCount = addNotes(itemsToSave);
    setSaveSuccessMessage(`표현 노트에 ${savedCount}개 저장했어요.`);
    onNotesSaved?.();
  };

  /** 첫 표현 소개 응답이 끝난 뒤부터 빠른 응답 버튼 표시 (초기 인사말·스트리밍 중인 첫 응답은 제외) */
  const hasIntroduced = messages.some(
    (m) =>
      m.role === 'assistant' &&
      !m.id.startsWith('init-') &&
      m.id !== streamingId &&
      m.content.trim() !== '',
  );

  /** 주제 선택 되돌리기 */
  const handleTopicBack = () => {
    if (isLoading) return;
    setSelectedTopic(null);
  };

  return (
    <div className="chatbot-container">
      {/* 헤더 (단독 실행 시에만 렌더링) */}
      {!hideHeader && (
        <header className="chatbot-header">
          <div className="chatbot-title-group">
            <h2>💼 직장 한국어 연습 도우미</h2>
            <p>외국인 직장인을 위한 직장 한국어 표현 학습 & 빈칸 채우기 복습 퀴즈</p>
          </div>
          <div className="chatbot-header-actions">
            <span className="model-badge" title="OpenAI Responses API / reasoning.effort: none">
              gpt-6-luna (effort: none)
            </span>
            <button
              type="button"
              className="reset-button"
              onClick={handleReset}
              disabled={isLoading}
              title="대화 초기화"
            >
              새 대화
            </button>
          </div>
        </header>
      )}

      {/* 2단계 추천 선택 바 */}
      <div className="quick-topics-bar">
        {selectedTopic === null ? (
          /* 1단계: 주제 선택 */
          <>
            <span className="quick-topics-label">주제 선택:</span>
            {TOPIC_OPTIONS.map((topic, idx) => (
              <button
                key={idx}
                type="button"
                className="quick-chip"
                onClick={() => handleTopicSelect(topic.value)}
                disabled={isLoading}
              >
                {topic.label}
              </button>
            ))}
          </>
        ) : (
          /* 2단계: 난이도 선택 */
          <>
            <button
              type="button"
              className="quick-back-button"
              onClick={handleTopicBack}
              disabled={isLoading}
              title="주제 다시 선택"
            >
              ← 주제 다시 선택
            </button>
            <span className="quick-topics-label">선택한 주제:</span>
            <span className="quick-chip quick-chip-selected">{selectedTopic}</span>
            <span className="quick-topics-divider">|</span>
            <span className="quick-topics-label">난이도:</span>
            {DIFFICULTY_OPTIONS.map((diff, idx) => (
              <button
                key={idx}
                type="button"
                className="quick-chip"
                onClick={() => handleDifficultySelect(diff.value)}
                disabled={isLoading}
              >
                {diff.label}
              </button>
            ))}
          </>
        )}
      </div>

      {/* 에러 알림 배너 */}
      {errorMessage && (
        <div className="error-banner">
          <div>
            <strong>⚠️ 오류:</strong> {errorMessage}
            {errorMessage.includes('OPENAI_API_KEY') && (
              <div style={{ marginTop: '6px', fontSize: '0.82rem', lineHeight: '1.5' }}>
                <div>🚀 <strong>Vercel 배포 환경:</strong> Vercel 대시보드 → 프로젝트 선택 → <strong>Settings</strong> → <strong>Environment Variables</strong>에서 <code>OPENAI_API_KEY</code>를 등록한 후 재배포(Redeploy)해 주세요.</div>
                <div style={{ marginTop: '4px' }}>💻 <strong>로컬 환경:</strong> 프로젝트 루트의 <code>.env.local</code> 파일에 <code>OPENAI_API_KEY=your_key_here</code>를 입력해 주세요.</div>
              </div>
            )}
          </div>
          <button
            type="button"
            className="error-banner-close"
            onClick={() => setErrorMessage(null)}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
      )}

      {/* 메시지 스크롤 영역 */}
      <div className="messages-container">
        {messages.map((msg) => {
          // [[NOTES]] 메타 블록과 스트리밍 중 마커 일부는 화면에서 숨김
          // AI 응답에 새어 나온 문형 목록 출처 표시([격식], [Y2-9·추정] 등)도 지움
          const cleaned = cleanDisplayContent(msg.content);
          const displayContent = msg.role === 'assistant' ? stripSourceTags(cleaned) : cleaned;
          return (
            <div key={msg.id} className={`message-row ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === 'user' ? '👤' : '🤖'}
              </div>
              <div className="message-bubble">
                {/* 스트리밍 중인 메시지가 아직 비어있으면 타이핑 인디케이터 표시 */}
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
                    numberedTitles={msg.role === 'assistant'}
                  />
                )}
              </div>
            </div>
          );
        })}

        <div ref={messagesEndRef} />
      </div>

      {/* 표현 노트 저장 UI (🟡 부분 정답·❌ 오답 채점 후) */}
      <NotesSaveBox
        notes={feedbackNotes}
        selected={selectedNoteIndices}
        onToggle={handleToggleNote}
        onSelectAll={(all) => setSelectedNoteIndices(all ? new Set(feedbackNotes.map((_, i) => i)) : new Set())}
        onSave={handleSaveSelectedNotes}
        disabled={isLoading}
        message={saveSuccessMessage}
      />

      {/* 빠른 응답 버튼: 첫 표현 소개 후 표시, 스트리밍 중 비활성화, 초기화 시 숨김 */}
      {hasIntroduced && (
        <div className="quick-topics-bar quick-replies-bar">
          {QUICK_REPLIES.map((reply) => (
            <button
              key={reply.value}
              type="button"
              className="quick-chip"
              onClick={() => handleSendMessage(reply.value)}
              disabled={isLoading}
            >
              {reply.label}
            </button>
          ))}
        </div>
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
            placeholder="상황에 맞는 직장 표현을 작성하거나 AI에게 질문해 보세요... (Enter 전송, Shift+Enter 줄바꿈)"
            disabled={isLoading}
          />
          <button
            type="submit"
            className="send-button"
            disabled={isLoading || !input.trim()}
          >
            전송
          </button>
        </form>
        <div className="input-hint">
          <span>엔터(Enter) 키로 전송하고 쉬프트+엔터(Shift+Enter)로 줄을 바꿉니다.</span>
          <span>API Key는 프런트엔드에 노출되지 않고 안전하게 서버에서 처리됩니다.</span>
        </div>
      </div>
    </div>
  );
};

export default Chatbot;
