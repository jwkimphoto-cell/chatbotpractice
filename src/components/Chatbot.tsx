import React, { useState, useRef, useEffect, useCallback } from 'react';
import { streamChatMessage, type ChatMessage } from '../api/chat';
import './Chatbot.css';

interface DisplayMessage extends ChatMessage {
  id: string;
}

const INITIAL_GREETING = `안녕하세요! 직장 한국어 연습 챗봇입니다. 💼
보고, 회의, 비즈니스 이메일 등 다양한 직장 상황에서 상대와 맥락에 맞는 한국어 표현을 연습하고 맞춤 피드백을 받아보세요.

연습하고 싶으신 **직장 상황(보고·회의·이메일 등)**과 **난이도(초급/중급/고급)**를 말씀해 주시면 바로 실전 연습을 시작하겠습니다!`;

/** 1단계: 주제 선택 목록 */
const TOPIC_OPTIONS = [
  { label: '📊 주간 회의', value: '주간 회의' },
  { label: '📅 월간 회의', value: '월간 회의' },
  { label: '📢 마케팅 회의', value: '마케팅 회의' },
  { label: '🚀 신사업 회의', value: '신사업 회의' },
];

/** 2단계: 난이도 선택 목록 */
const DIFFICULTY_OPTIONS = [
  { label: '🟢 초급', value: '초급' },
  { label: '🟡 중급', value: '중급' },
  { label: '🔴 고급', value: '고급' },
];

export const Chatbot: React.FC = () => {
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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

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
    if (!trimmed || isLoading) return;

    setErrorMessage(null);

    const userMessage: DisplayMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    setIsLoading(true);

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
      // API 전송용 메시지 목록 (role과 content만 전달, placeholder 제외)
      const apiPayload: ChatMessage[] = newMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      await streamChatMessage(apiPayload, (chunk) => {
        appendDelta(assistantId, chunk);
      });
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
      setIsLoading(false);
      setStreamingId(null);
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

  const handleReset = () => {
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
  };

  /** 1단계: 주제 선택 */
  const handleTopicSelect = (topicValue: string) => {
    if (isLoading) return;
    setSelectedTopic(topicValue);
  };

  /** 2단계: 난이도 선택 → 메시지 전송 */
  const handleDifficultySelect = (difficultyValue: string) => {
    if (isLoading || !selectedTopic) return;
    const prompt = `주제: ${selectedTopic}\n난이도: ${difficultyValue}\n위 조건에 맞는 회의 한국어 대화 연습을 시작해줘.`;
    setSelectedTopic(null);
    handleSendMessage(prompt);
  };

  /** 주제 선택 되돌리기 */
  const handleTopicBack = () => {
    if (isLoading) return;
    setSelectedTopic(null);
  };

  return (
    <div className="chatbot-container">
      {/* 헤더 */}
      <header className="chatbot-header">
        <div className="chatbot-title-group">
          <h2>💼 직장 한국어 연습 챗봇</h2>
          <p>보고 · 회의 · 이메일 직장담화 롤플레잉 & 비즈니스 표현 피드백</p>
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
              ←
            </button>
            <span className="quick-chip quick-chip-selected">{selectedTopic}</span>
            <span className="quick-topics-divider">›</span>
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
              <div style={{ marginTop: '4px', fontSize: '0.82rem' }}>
                💡 프로젝트 루트의 <code>.env.local</code> 파일에 <code>OPENAI_API_KEY=your_key_here</code>를 입력한 후 다시 시도해 주세요.
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
        {messages.map((msg) => (
          <div key={msg.id} className={`message-row ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-bubble">
              {/* 스트리밍 중인 메시지가 아직 비어있으면 타이핑 인디케이터 표시 */}
              {msg.id === streamingId && msg.content === '' ? (
                <span className="typing-indicator">
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                  <span className="typing-dot" />
                </span>
              ) : (
                <>
                  {msg.content}
                  {msg.id === streamingId && <span className="streaming-cursor" />}
                </>
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

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
