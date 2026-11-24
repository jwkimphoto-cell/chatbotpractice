import React from 'react';
import type { ParsedNoteItem } from '../utils/meta';

/**
 * 표현 노트 저장 상자 (표현 연습·롤플레이·이메일 공통).
 * 체크박스는 처음에 모두 비어 있고, 학습자가 직접 고르거나 [전체 선택]을 누름 (자동 저장·자동 선택 없음).
 */
interface Props {
  notes: ParsedNoteItem[];
  selected: Set<number>;
  onToggle: (index: number) => void;
  /** 전체 선택(true) 또는 전체 해제(false) */
  onSelectAll: (all: boolean) => void;
  onSave: () => void;
  disabled?: boolean;
  message?: string | null;
}

export const NotesSaveBox: React.FC<Props> = ({ notes, selected, onToggle, onSelectAll, onSave, disabled = false, message }) => {
  if (notes.length === 0) return null;
  const allSelected = selected.size === notes.length;
  return (
    <div className="notes-save-box">
      <div className="notes-save-header">
        <strong>📝 복습 노트로 저장할 표현을 선택하세요</strong>
        <span className="notes-save-sub">선택한 표현은 '나의 표현 노트' 탭에서 복습할 수 있습니다.</span>
      </div>
      <div className="notes-checkbox-list">
        {notes.map((item, idx) => (
          <label key={idx} className="note-checkbox-item">
            <input type="checkbox" checked={selected.has(idx)} onChange={() => onToggle(idx)} />
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
        <button type="button" className="quick-chip" onClick={() => onSelectAll(!allSelected)} disabled={disabled}>
          {allSelected ? '전체 해제' : '전체 선택'}
        </button>
        <button type="button" className="save-notes-btn" onClick={onSave} disabled={selected.size === 0 || disabled}>
          선택한 표현 노트에 저장 ({selected.size}개)
        </button>
        {message && <span className="save-success-msg">✓ {message}</span>}
      </div>
    </div>
  );
};

export default NotesSaveBox;
