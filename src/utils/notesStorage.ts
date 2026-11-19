import { isPassingVerdict, type NoteCategory, type ReviewVerdict } from './meta';

export interface NoteCard {
  id: string;
  createdAt: string; // ISO 날짜
  source: 'roleplay' | 'email' | 'expression';
  scene: string;
  counterpart: string;
  original: string;
  corrected: string;
  category: NoteCategory;
  reason: string;
  box: number; // 0 ~ 4
  nextReviewAt: string; // ISO 날짜
  reviewCount: number;
  /** 'partial'은 4단계 채점 도입 후 추가. 기존 카드의 'correct'·'incorrect'도 그대로 읽힘 */
  lastResult?: 'correct' | 'partial' | 'incorrect';
}

const STORAGE_KEY = 'officeKoreanCoach.notes.v1';
const MAX_CARDS = 500;

// 라이트너 박스별 복습 간격 (일 단위)
const BOX_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;

function calculateNextReviewDate(box: number, baseDate: Date = new Date()): Date {
  const safeBox = Math.max(0, Math.min(box, BOX_INTERVAL_DAYS.length - 1));
  const daysToAdd = BOX_INTERVAL_DAYS[safeBox];
  const nextDate = new Date(baseDate.getTime());
  nextDate.setDate(nextDate.getDate() + daysToAdd);
  return nextDate;
}

function isValidCard(c: unknown): c is NoteCard {
  if (!c || typeof c !== 'object') return false;
  const card = c as Record<string, unknown>;
  return (
    typeof card.id === 'string' &&
    typeof card.original === 'string' &&
    typeof card.corrected === 'string' &&
    typeof card.nextReviewAt === 'string' &&
    typeof card.box === 'number' &&
    typeof card.reviewCount === 'number'
  );
}

/** 오늘(로컬 시간) 하루의 끝. 다음 복습일이 오늘 날짜 이내면 "오늘 복습" 대상 */
function endOfDay(date: Date): Date {
  const d = new Date(date.getTime());
  d.setHours(23, 59, 59, 999);
  return d;
}

export function loadNotes(): NoteCard[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      // 손상된 항목이 있어도 화면이 깨지지 않도록 필수 필드가 있는 카드만 사용
      return parsed.filter(isValidCard);
    }
    return [];
  } catch {
    return [];
  }
}

export function saveNotes(cards: NoteCard[]): void {
  if (typeof window === 'undefined') return;
  try {
    const capped = cards.slice(0, MAX_CARDS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch (err) {
    console.error('Failed to save notes to localStorage:', err);
  }
}

export type NewNoteInput = Omit<
  NoteCard,
  'id' | 'createdAt' | 'box' | 'nextReviewAt' | 'reviewCount' | 'lastResult'
>;

/**
 * 새 카드를 저장합니다. (동일 original + corrected 조합은 중복 방지)
 * @returns 추가된 카드의 개수
 */
export function addNotes(items: NewNoteInput[]): number {
  if (!items || items.length === 0) return 0;

  const current = loadNotes();
  const existingKeys = new Set(current.map((c) => `${c.original.trim()}:::${c.corrected.trim()}`));

  const now = new Date();
  const nextDate = calculateNextReviewDate(0, now);

  const newCards: NoteCard[] = [];
  for (const item of items) {
    const key = `${item.original.trim()}:::${item.corrected.trim()}`;
    if (!existingKeys.has(key)) {
      existingKeys.add(key);
      newCards.push({
        ...item,
        id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: now.toISOString(),
        box: 0,
        nextReviewAt: nextDate.toISOString(),
        reviewCount: 0,
      });
    }
  }

  if (newCards.length > 0) {
    saveNotes([...newCards, ...current]);
  }

  return newCards.length;
}

/**
 * 오늘 복습해야 할 카드 목록을 반환합니다.
 */
export function getDueCards(today: Date = new Date()): NoteCard[] {
  const cards = loadNotes();
  // 복습 간격은 "일" 단위이므로 시각이 아니라 날짜로 비교
  const nowTime = endOfDay(today).getTime();
  return cards.filter((card) => {
    const reviewTime = new Date(card.nextReviewAt).getTime();
    return reviewTime <= nowTime;
  });
}

/**
 * 오늘 복습해야 할 카드 수를 반환합니다.
 */
export function getDueCardsCount(today: Date = new Date()): number {
  return getDueCards(today).length;
}

/**
 * 복습 결과(4단계 판정)에 따라 카드의 박스와 다음 복습일을 갱신합니다.
 * - correct·alternative → box +1 (최대 4)
 * - partial → box 유지, 다음 복습은 1일 뒤
 * - incorrect → box 0, 다음 복습은 1일 뒤
 */
export function recordReviewResult(id: string, verdict: ReviewVerdict): NoteCard | null {
  const cards = loadNotes();
  const idx = cards.findIndex((c) => c.id === id);
  if (idx === -1) return null;

  const card = cards[idx];
  const now = new Date();

  const passed = isPassingVerdict(verdict);
  let nextBox: number;
  let nextReviewDate: Date;
  if (passed) {
    nextBox = Math.min(card.box + 1, 4);
    nextReviewDate = calculateNextReviewDate(nextBox, now);
  } else if (verdict === 'partial') {
    nextBox = card.box;
    nextReviewDate = calculateNextReviewDate(0, now); // 1일 뒤
  } else {
    nextBox = 0;
    nextReviewDate = calculateNextReviewDate(0, now); // 1일 뒤
  }

  const updated: NoteCard = {
    ...card,
    box: nextBox,
    nextReviewAt: nextReviewDate.toISOString(),
    reviewCount: card.reviewCount + 1,
    lastResult: passed ? 'correct' : verdict === 'partial' ? 'partial' : 'incorrect',
  };

  cards[idx] = updated;
  saveNotes(cards);
  return updated;
}

/**
 * 특정 카드를 삭제합니다.
 */
export function deleteNote(id: string): void {
  const cards = loadNotes();
  const filtered = cards.filter((c) => c.id !== id);
  saveNotes(filtered);
}
