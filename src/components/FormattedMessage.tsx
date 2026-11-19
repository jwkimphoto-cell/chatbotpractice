import React from 'react';

interface FormattedMessageProps {
  content: string;
  isStreaming?: boolean;
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
export const FormattedMessage: React.FC<FormattedMessageProps> = ({ content, isStreaming }) => {
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

        // 번호 목록 (1. 항목, 2. 항목 등)
        const numMatch = line.match(/^(\d+)\.\s+(.*)$/);
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
