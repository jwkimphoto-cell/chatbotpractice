import React from 'react';

interface FormattedMessageProps {
  content: string;
  isStreaming?: boolean;
  /**
   * true면 "1. 문장" 번호 줄을 항목 제목(굵은 글씨 + 왼쪽 강조선)으로 표시하고,
   * 공백 3칸 이상으로 들여쓴 표시 없는 줄을 하위 항목의 이어지는 줄로 들여씁니다.
   * 표현 연습(대표 문장 카드)에서만 사용 — 롤플레이·이메일 피드백의 번호 목록은 기존 모양 유지.
   */
  numberedTitles?: boolean;
}

/**
 * 인라인 마크다운 파싱: **bold**, `code`, *italic*
 */
function renderInline(text: string): React.ReactNode[] {
  const tokens: React.ReactNode[] = [];
  // **bold**, `code`, *italic* 정규식
  const regex = /(\*\*[^*]+?\*\*|`[^`]+?`|\*[^*]+?\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }
    const full = match[0];
    if (full.startsWith('**') && full.endsWith('**')) {
      tokens.push(
        <strong key={match.index} className="msg-bold">
          {full.slice(2, -2)}
        </strong>
      );
    } else if (full.startsWith('`') && full.endsWith('`')) {
      tokens.push(
        <code key={match.index} className="msg-code">
          {full.slice(1, -1)}
        </code>
      );
    } else if (full.startsWith('*') && full.endsWith('*')) {
      tokens.push(
        <em key={match.index} className="msg-italic">
          {full.slice(1, -1)}
        </em>
      );
    } else {
      tokens.push(full);
    }
    lastIndex = match.index + full.length;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens.length > 0 ? tokens : [text];
}

/**
 * AI 응답의 마크다운(### 제목, **굵은 글씨**, 목록, 줄바꿈 등)을 깔끔하게 서식화하여 렌더링하는 컴포넌트
 */
export const FormattedMessage: React.FC<FormattedMessageProps> = ({ content, isStreaming, numberedTitles = false }) => {
  const lines = content.split('\n');

  return (
    <div className="formatted-message">
      {lines.map((line, idx) => {
        const isLastLine = idx === lines.length - 1;
        const cursor = isStreaming && isLastLine ? <span className="streaming-cursor" /> : null;
        const trimmed = line.trim();

        // ### 헤더 (h4)
        if (line.startsWith('### ')) {
          return (
            <h4 key={idx} className="msg-heading-3">
              {renderInline(line.slice(4))}
              {cursor}
            </h4>
          );
        }

        // ## 헤더 (h3)
        if (line.startsWith('## ')) {
          return (
            <h3 key={idx} className="msg-heading-2">
              {renderInline(line.slice(3))}
              {cursor}
            </h3>
          );
        }

        // # 헤더 (h2)
        if (line.startsWith('# ')) {
          return (
            <h2 key={idx} className="msg-heading-1">
              {renderInline(line.slice(2))}
              {cursor}
            </h2>
          );
        }

        // 구분선 (--- 또는 ***)
        if (trimmed === '---' || trimmed === '***') {
          return (
            <React.Fragment key={idx}>
              <hr className="msg-divider" />
              {cursor}
            </React.Fragment>
          );
        }

        // 불릿 목록 (- 항목 또는 * 항목)
        if (/^[-*]\s+/.test(line)) {
          const bulletContent = line.replace(/^[-*]\s+/, '');
          return (
            <div key={idx} className="msg-bullet-item">
              <span className="msg-bullet-dot">•</span>
              <span className="msg-bullet-content">
                {renderInline(bulletContent)}
                {cursor}
              </span>
            </div>
          );
        }

        // 하위 항목: "  · 기능: …" (들여쓴 '·'/'•' 또는 공백 2칸 이상 들여쓴 '-'/'*')
        const subMatch = line.match(/^\s*[·•]\s*(.*)$/) || line.match(/^\s{2,}[-*]\s+(.*)$/);
        if (subMatch) {
          return (
            <div key={idx} className="msg-subbullet-item">
              <span className="msg-subbullet-dot">·</span>
              <span className="msg-subbullet-content">
                {renderInline(subMatch[1])}
                {cursor}
              </span>
            </div>
          );
        }

        // 하위 항목의 이어지는 줄 (예: 초급 "· 기능" 아래 공백 4칸 영어 설명)
        if (numberedTitles && /^\s{3,}\S/.test(line)) {
          return (
            <div key={idx} className="msg-subbullet-cont">
              {renderInline(trimmed)}
              {cursor}
            </div>
          );
        }

        // 번호 목록 (1. 항목, 2. 항목 등)
        const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
        if (numMatch && numberedTitles) {
          // 제목 전체를 ** **로 감싼 경우는 벗겨서 칩 배경 없이 제목 스타일만 적용
          const titleText = numMatch[2].replace(/^\*\*(.+)\*\*$/, '$1');
          return (
            <div key={idx} className="msg-number-title">
              <span className="msg-number-prefix">{numMatch[1]}.</span>
              <span className="msg-number-title-text">
                {renderInline(titleText)}
                {cursor}
              </span>
            </div>
          );
        }
        if (numMatch) {
          return (
            <div key={idx} className="msg-number-item">
              <span className="msg-number-prefix">{numMatch[1]}.</span>
              <span className="msg-number-content">
                {renderInline(numMatch[2])}
                {cursor}
              </span>
            </div>
          );
        }

        // 빈 줄
        if (!trimmed) {
          return (
            <div key={idx} className="msg-empty-line">
              {cursor}
            </div>
          );
        }

        // 일반 단락
        return (
          <p key={idx} className="msg-paragraph">
            {renderInline(line)}
            {cursor}
          </p>
        );
      })}
    </div>
  );
};

export default FormattedMessage;
