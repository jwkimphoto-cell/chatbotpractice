import { useState, useCallback } from 'react';
import { Chatbot } from './components/Chatbot';
import { RoleplayPractice } from './components/RoleplayPractice';
import { EmailCoach } from './components/EmailCoach';
import { ExpressionNotes } from './components/ExpressionNotes';
import { getDueCardsCount } from './utils/notesStorage';
import './App.css';
import './components/Chatbot.css';

type AppTab = 'expression' | 'roleplay' | 'email' | 'notes';

export function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('expression');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [dueCardsCount, setDueCardsCount] = useState<number>(() => getDueCardsCount());

  // 탭별 대화 초기화 신호 (버튼 클릭 시 숫자 증가)
  const [expressionReset, setExpressionReset] = useState<number>(0);
  const [roleplayReset, setRoleplayReset] = useState<number>(0);
  const [emailReset, setEmailReset] = useState<number>(0);

  const updateDueCount = useCallback(() => {
    setDueCardsCount(getDueCardsCount());
  }, []);

  // 탭을 바꿀 때마다 ●N을 다시 계산 (앱을 오래 켜 둔 사이 복습일이 지난 카드 반영)
  const switchTab = (tab: AppTab) => {
    setActiveTab(tab);
    updateDueCount();
  };

  // 헤더의 "대화 초기화" 버튼은 현재 활성화된 탭만 초기화
  const handleResetCurrentTab = () => {
    if (isStreaming) return;
    if (activeTab === 'expression') {
      setExpressionReset((prev) => prev + 1);
    } else if (activeTab === 'roleplay') {
      setRoleplayReset((prev) => prev + 1);
    } else if (activeTab === 'email') {
      setEmailReset((prev) => prev + 1);
    }
  };

  return (
    <div className="app-container">
      <div className="main-app-shell">
        {/* 공통 헤더 */}
        <header className="app-main-header">
          <div className="app-header-left">
            <h1 className="app-header-title">💼 오피스 한국어 코치</h1>
            <p className="app-header-subtitle">
              보고·회의·이메일 장면에서 대화하고, 쓰고, 피드백 받는 직장 한국어 연습
            </p>
          </div>
          <div className="app-header-right">
            <span className="model-badge" title="OpenAI Responses API / reasoning.effort: none">
              gpt-6-luna (effort: none)
            </span>
            {activeTab !== 'notes' && (
              <button
                type="button"
                className="reset-button"
                onClick={handleResetCurrentTab}
                disabled={isStreaming}
                title="현재 탭의 대화를 처음 상태로 초기화합니다."
              >
                대화 초기화
              </button>
            )}
          </div>
        </header>

        {/* 탭 네비게이션 바 */}
        <nav className="app-tab-nav" aria-label="기능 탭">
          <button
            type="button"
            className={`tab-nav-btn ${activeTab === 'expression' ? 'active' : ''}`}
            onClick={() => switchTab('expression')}
            disabled={isStreaming}
          >
            표현 연습
          </button>
          <button
            type="button"
            className={`tab-nav-btn ${activeTab === 'roleplay' ? 'active' : ''}`}
            onClick={() => switchTab('roleplay')}
            disabled={isStreaming}
          >
            상황 롤플레이
          </button>
          <button
            type="button"
            className={`tab-nav-btn ${activeTab === 'email' ? 'active' : ''}`}
            onClick={() => switchTab('email')}
            disabled={isStreaming}
          >
            이메일 첨삭
          </button>
          <button
            type="button"
            className={`tab-nav-btn ${activeTab === 'notes' ? 'active' : ''}`}
            onClick={() => switchTab('notes')}
            disabled={isStreaming}
          >
            나의 표현 노트
            {dueCardsCount > 0 && <span className="tab-due-badge">●{dueCardsCount}</span>}
          </button>
        </nav>

        {/* 탭별 본문 (display: none으로 유지하여 탭 전환 시 대화 내용/입력 상태 보존) */}
        <main className="app-content-body">
          <div style={{ display: activeTab === 'expression' ? 'flex' : 'none', height: '100%' }}>
            <Chatbot
              key={`expr-${expressionReset}`}
              hideHeader
              onStreamingChange={setIsStreaming}
              onNotesSaved={updateDueCount}
            />
          </div>

          <div style={{ display: activeTab === 'roleplay' ? 'flex' : 'none', height: '100%' }}>
            <RoleplayPractice
              key={`roleplay-${roleplayReset}`}
              onStreamingChange={setIsStreaming}
              onNotesSaved={updateDueCount}
            />
          </div>

          <div style={{ display: activeTab === 'email' ? 'flex' : 'none', height: '100%' }}>
            <EmailCoach
              key={`email-${emailReset}`}
              onStreamingChange={setIsStreaming}
              onNotesSaved={updateDueCount}
            />
          </div>

          <div style={{ display: activeTab === 'notes' ? 'flex' : 'none', height: '100%' }}>
            <ExpressionNotes
              onStreamingChange={setIsStreaming}
              isActive={activeTab === 'notes'}
              onNavigateTab={switchTab}
              onNotesCountChange={(count) => setDueCardsCount(count)}
            />
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
