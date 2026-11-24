import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// 브라우저 localStorage 대역 (window가 있어야 notesStorage가 동작함)
class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
const g = globalThis as Record<string, unknown>;
g.localStorage = new MemoryStorage();
g.window = globalThis;

const { addNotes, loadNotes, recordReviewResult, getDueCards } = await import('../src/utils/notesStorage.ts');

const KEY = 'officeKoreanCoach.notes.v1';
const DAY = 24 * 60 * 60 * 1000;
const storage = g.localStorage as MemoryStorage;
const base = { source: 'roleplay' as const, scene: '장면', counterpart: '팀장', category: '높임법' as const, reason: '이유' };

/** 다음 복습일까지 남은 날짜 수 (반올림) */
const daysUntil = (iso: string) => Math.round((new Date(iso).getTime() - Date.now()) / DAY);

describe('표현 노트 저장소', () => {
  beforeEach(() => storage.clear());

  test('새 카드는 box 0, 1일 뒤 복습, 중복(original+corrected)은 저장하지 않음', () => {
    assert.equal(addNotes([{ ...base, original: 'a', corrected: 'b' }, { ...base, original: 'a', corrected: 'b' }]), 1);
    assert.equal(addNotes([{ ...base, original: ' a ', corrected: 'b' }]), 0);
    const [card] = loadNotes();
    assert.equal(card.box, 0);
    assert.equal(daysUntil(card.nextReviewAt), 1);
  });

  const cases: [string, number, number, number][] = [
    // verdict, 시작 box, 기대 box, 기대 다음 복습(일)
    ['correct', 0, 1, 3],
    ['alternative', 2, 3, 14],
    ['correct', 4, 4, 30],
    ['partial', 2, 2, 1],
    ['incorrect', 3, 0, 1],
  ];
  for (const [verdict, from, box, days] of cases) {
    test(`${verdict}: box ${from} → ${box}, ${days}일 뒤`, () => {
      addNotes([{ ...base, original: 'o', corrected: 'c' }]);
      const cards = loadNotes();
      cards[0].box = from;
      storage.setItem(KEY, JSON.stringify(cards));
      const updated = recordReviewResult(cards[0].id, verdict as 'correct');
      assert.ok(updated);
      assert.equal(updated.box, box);
      assert.equal(daysUntil(updated.nextReviewAt), days);
      assert.equal(updated.reviewCount, 1);
      assert.equal(updated.lastResult, verdict === 'alternative' ? 'correct' : verdict);
    });
  }

  test("옛 형식 카드(lastResult 'correct'/'incorrect', source 'email')도 그대로 읽힘", () => {
    const old = [
      { id: 'old-1', createdAt: '2026-10-01T00:00:00.000Z', source: 'email', scene: '이메일 첨삭', counterpart: '거래처 담당자', original: 'x', corrected: 'y', category: '완곡 표현', reason: 'r', box: 2, nextReviewAt: '2026-10-05T00:00:00.000Z', reviewCount: 3, lastResult: 'incorrect' },
      { id: 'old-2', createdAt: '2026-10-01T00:00:00.000Z', source: 'roleplay', scene: 's', counterpart: 'c', original: 'p', corrected: 'q', category: '높임법', reason: 'r', box: 1, nextReviewAt: '2999-01-01T00:00:00.000Z', reviewCount: 1, lastResult: 'correct' },
      { broken: true },
    ];
    storage.setItem(KEY, JSON.stringify(old));
    const cards = loadNotes();
    assert.equal(cards.length, 2);
    assert.equal(cards[0].source, 'email');
    assert.equal(cards[0].lastResult, 'incorrect');
    assert.deepEqual(getDueCards().map((c) => c.id), ['old-1']);
  });

  test('손상된 저장값은 빈 목록', () => {
    storage.setItem(KEY, '{not json');
    assert.deepEqual(loadNotes(), []);
  });

  test('오늘 복습은 시각이 아니라 날짜 기준 (오늘 밤 23시 예정 카드도 포함)', () => {
    const tonight = new Date();
    tonight.setHours(23, 0, 0, 0);
    storage.setItem(KEY, JSON.stringify([{ id: 't', createdAt: '', source: 'expression', scene: '', counterpart: '', original: 'a', corrected: 'b', category: '높임법', reason: '', box: 0, nextReviewAt: tonight.toISOString(), reviewCount: 0 }]));
    assert.equal(getDueCards().length, 1);
  });
});
