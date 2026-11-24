import React, { useEffect, useRef, useState } from 'react';
import { ChatApiError, streamChatMessage, type ChatMessage, type RoleplayLevel, type SupportType } from '../api/chat';
import {
  extractSupport,
  normalizeUtterance,
  replyToMatches,
  type SupportChoiceOption,
  type SupportChoicesBody,
  type SupportData,
  type SupportFrameBody,
  type SupportHint,
  type SupportModel,
  type SupportVerdict,
} from '../utils/meta';

/**
 * 롤플레이 도움 사다리 패널 (💡 방향 힌트 → ✏️ 문장 틀 → 🔘 보기 선택 → 👀 모범 답)
 * - 부모가 상대역 발화마다 key를 바꿔 새로 마운트함 → 이전 턴의 도움은 자동으로 사라짐
 * - 부모는 상대역 응답 스트리밍이 끝나고 내용이 비어 있지 않을 때만 이 패널을 마운트함
 * - 요청 직전에 getHistory()로 최신 대화 기록을 읽고, 마지막 상대역 발화가 targetText와 같을 때만 보냄
 * - 응답의 replyTo가 targetText와 다르면 버리고 자동으로 한 번만 다시 요청함 (두 번째도 다르면 [다시 시도])
 * - 캐시 키는 turnKey(상대역 발화 순번 + 발화 해시) + 도움 종류. 새 턴이 되면 이전 턴 항목은 지움
 * - 도움 요청·응답은 롤플레이 대화 기록에 넣지 않음 (부모의 messages를 읽기만 함)
 */

export type StepType = 'hint' | 'frame' | 'choices' | 'model';
export type InsertSource = 'frame' | 'choices' | 'model';

const STEP_ORDER: StepType[] = ['hint', 'frame', 'choices', 'model'];
const STEP_LABEL: Record<StepType, { ko: string; en: string }> = {
  hint: { ko: '💡 방향 힌트', en: 'Hint' },
  frame: { ko: '✏️ 문장 틀', en: 'Sentence frame' },
  choices: { ko: '🔘 보기 선택', en: 'Choose the best' },
  model: { ko: '👀 모범 답', en: 'Model answer' },
};
const VERDICT_ICON: Record<SupportVerdict, string> = { appropriate: '✅', partial: '🟡', inappropriate: '❌' };

interface Props {
  sceneId: string;
  level: RoleplayLevel;
  /** 요청 직전에 부르는 최신 대화 기록 읽기 (마지막이 상대역의 말, 메타 블록 제거). 클로저로 잡은 값을 쓰지 않기 위함 */
  getHistory: () => ChatMessage[];
  /** 이 패널이 돕는 상대역 발화 (방금 끝난 마지막 상대역 말) */
  targetText: string;
  /** 상대역 발화 순번 + 발화 텍스트 해시 (캐시 키 앞부분) */
  turnKey: string;
  /** 부모가 가진 도움 캐시 (키: `${turnKey}:${type}`) */
  cache: Map<string, SupportData>;
  /** 롤플레이 응답 스트리밍 중이면 true */
  disabled: boolean;
  onInsert: (text: string, source: InsertSource) => void;
  /** 학습자가 도움을 실제로 쓴 순간 (턴마다 종류별 1회) */
  onUse: (type: StepType) => void;
  /** 이 턴에서 처음 고른 보기의 판정 */
  onFirstChoice: (verdict: SupportVerdict) => void;
}

interface Results {
  hint?: SupportHint;
  frame?: SupportFrameBody;
  choices?: SupportChoicesBody;
  model?: SupportModel;
}

type ErrorKind = 'parse' | 'rate';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const RoleplaySupportPanel: React.FC<Props> = ({
  sceneId,
  level,
  getHistory,
  targetText,
  turnKey,
  cache,
  disabled,
  onInsert,
  onUse,
  onFirstChoice,
}) => {
  const isBeginner = level === '초급';
  const autoStarter = isBeginner && !disabled;

  const [results, setResults] = useState<Results>({});
  const [opened, setOpened] = useState<StepType[]>([]);
  // 초급은 마운트하자마자 starter를 요청하므로 처음부터 로딩 상태로 시작 (effect 안에서 동기 setState 하지 않음)
  const [loading, setLoading] = useState<SupportType | null>(autoStarter ? 'starter' : null);
  const [error, setError] = useState<{ kind: ErrorKind; type: SupportType } | null>(null);
  const [rateLimited, setRateLimited] = useState(false);

  // 🔘 보기 선택 상태
  const [choiceOrder, setChoiceOrder] = useState<SupportChoiceOption[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  // ✏️ 문장 틀 입력값
  const [blankValues, setBlankValues] = useState<Record<number, string>>({});
  // 지금 할 말 (도움 응답의 intent)
  const [intent, setIntent] = useState<{ ko: string; en: string } | null>(null);

  const usedRef = useRef<Set<StepType>>(new Set());
  const inFlightRef = useRef(false);
  const rateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markUsed = (type: StepType) => {
    if (usedRef.current.has(type)) return;
    usedRef.current.add(type);
    onUse(type);
  };

  const applyData = (data: SupportData) => {
    if (data.intent) setIntent((cur) => cur ?? { ko: data.intent, en: data.intent_en });
    if (data.type === 'starter') {
      setResults((r) => ({ ...r, frame: data.frame, choices: data.choices }));
      setChoiceOrder(shuffle(data.choices.options));
      setOpened((o) => [...new Set([...o, 'frame' as StepType, 'choices' as StepType])]);
    } else if (data.type === 'choices') {
      setResults((r) => ({ ...r, choices: { options: data.options } }));
      setChoiceOrder(shuffle(data.options));
    } else if (data.type === 'frame') {
      setResults((r) => ({ ...r, frame: { template: data.template, blanks: data.blanks } }));
    } else if (data.type === 'hint') {
      setResults((r) => ({ ...r, hint: data }));
    } else {
      setResults((r) => ({ ...r, model: data }));
    }
  };

  /** 도움 요청 (한 번에 하나만). 캐시가 있으면 API를 부르지 않음 */
  const request = async (type: SupportType, alreadyLoading = false) => {
    const cacheKey = `${turnKey}:${type}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.info(`[RoleplaySupport] 캐시 사용: ${type} (API 호출 없음)`);
      applyData(cached);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!alreadyLoading) setLoading(type);
    setError(null);
    try {
      // replyTo가 다르면 한 번만 자동으로 다시 요청 (무한 재시도 금지)
      for (let attempt = 1; attempt <= 2; attempt++) {
        // 요청 직전에 최신 대화 기록을 읽고, 마지막 상대역 발화가 이 패널의 대상과 같은지 다시 확인
        const history = getHistory();
        const last = history[history.length - 1];
        if (!last || last.role !== 'assistant' || !last.content.trim() || normalizeUtterance(last.content) !== normalizeUtterance(targetText)) {
          console.warn('[RoleplaySupport] 마지막 상대역 발화가 이 도움의 대상과 달라 요청하지 않음');
          return;
        }
        if (import.meta.env.DEV) {
          console.debug(`[RoleplaySupport] 도움 요청(${type}, ${attempt}번째) — 마지막 상대역 발화:`, last.content);
        }
        console.info(`[RoleplaySupport] API 요청: ${type}`);
        const reply = await streamChatMessage(history, () => {}, { mode: 'roleplay_support', sceneId, level, supportType: type });
        const parsed = extractSupport(reply, type);
        if (!parsed.ok) {
          console.warn('[RoleplaySupport] 도움 응답 파싱 실패:', parsed.error, reply);
          setError({ kind: 'parse', type });
          return;
        }
        if (!replyToMatches(parsed.data.replyTo, targetText)) {
          console.warn(`[RoleplaySupport] replyTo 불일치 (${attempt}번째):`, parsed.data.replyTo, '≠', targetText);
          if (attempt === 1) continue;
          setError({ kind: 'parse', type });
          return;
        }
        cache.set(cacheKey, parsed.data);
        applyData(parsed.data);
        return;
      }
    } catch (e) {
      console.error('[RoleplaySupport] 도움 요청 오류:', e);
      if (e instanceof ChatApiError && e.status === 429) {
        setError({ kind: 'rate', type });
        setRateLimited(true);
        if (rateTimerRef.current) clearTimeout(rateTimerRef.current);
        rateTimerRef.current = setTimeout(() => setRateLimited(false), 30_000);
      } else {
        setError({ kind: 'parse', type });
      }
    } finally {
      inFlightRef.current = false;
      setLoading(null);
    }
  };

  // 초급: 상대역 발화가 끝날 때마다(=이 패널이 새로 마운트될 때) starter를 자동으로 1번 요청
  useEffect(() => {
    // 이전 턴(또는 이전 세션)의 캐시 항목은 지움
    for (const key of [...cache.keys()]) {
      if (!key.startsWith(`${turnKey}:`)) cache.delete(key);
    }
    if (autoStarter) void request('starter', true);
    return () => {
      if (rateTimerRef.current) clearTimeout(rateTimerRef.current);
    };
    // 마운트 시 한 번만 실행 (턴이 바뀌면 부모가 key를 바꿔 새로 마운트함)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = disabled || loading !== null || rateLimited;

  /** 단계 열기 (중급·고급의 [💡 도움], 초급의 힌트·모범 답 버튼) */
  const openStep = (type: StepType) => {
    if (busy) return;
    markUsed(type);
    setOpened((o) => (o.includes(type) ? o : [...o, type]));
    if (!results[type]) void request(type);
  };

  const nextStep = STEP_ORDER.find((t) => !opened.includes(t));

  // ---------- 렌더링 도우미 ----------
  const en = (text: string) => (isBeginner && text ? <span className="support-en">{text}</span> : null);

  const renderHint = (h: SupportHint) => (
    <ol className="support-hint-list">
      {h.steps.map((s, i) => (
        <li key={i}>
          {s}
          {en(h.steps_en[i])}
        </li>
      ))}
    </ol>
  );

  const renderFrame = (f: SupportFrameBody) => {
    const parts = f.template.split(/(\{\{\d+\}\})/);
    const allFilled = f.blanks.every((b) => (blankValues[b.id] ?? '').trim() !== '');
    const filledText = f.template.replace(/\{\{(\d+)\}\}/g, (_, n) => (blankValues[Number(n)] ?? '').trim());
    return (
      <>
        <div className="support-frame-line">
          {parts.map((part, i) => {
            const m = part.match(/^\{\{(\d+)\}\}$/);
            if (!m) return <span key={i}>{part}</span>;
            const id = Number(m[1]);
            const blank = f.blanks.find((b) => b.id === id);
            return (
              <span key={i} className="support-blank">
                <input
                  type="text"
                  className="support-blank-input"
                  aria-label={`빈칸 ${id}: ${blank?.hint ?? ''}`}
                  value={blankValues[id] ?? ''}
                  onChange={(e) => setBlankValues((v) => ({ ...v, [id]: e.target.value }))}
                  disabled={disabled}
                />
                <span className="support-blank-hint">
                  {blank?.hint}
                  {isBeginner && blank?.hint_en ? ` (${blank.hint_en})` : ''}
                </span>
              </span>
            );
          })}
        </div>
        <button
          type="button"
          className="quick-chip support-insert-btn"
          aria-label="완성한 문장을 입력창에 넣기"
          disabled={busy || !allFilled}
          onClick={() => {
            markUsed('frame');
            onInsert(filledText, 'frame');
          }}
        >
          입력창에 넣기
        </button>
      </>
    );
  };

  const renderChoices = () => {
    const wrongCount = picked.filter((id) => choiceOrder.find((o) => o.id === id)?.verdict !== 'appropriate').length;
    const correct = choiceOrder.find((o) => o.verdict === 'appropriate');
    const pickedCorrect = correct ? picked.includes(correct.id) : false;
    return (
      <>
        <div className="support-choice-list" role="group" aria-label="보기 선택">
          {choiceOrder.map((o, idx) => {
            const chosen = picked.includes(o.id);
            const highlight = !pickedCorrect && wrongCount >= 2 && o.verdict === 'appropriate';
            return (
              <button
                key={o.id}
                type="button"
                className={`support-choice ${chosen ? `chosen ${o.verdict}` : ''} ${highlight ? 'highlight' : ''}`}
                aria-label={`보기 ${idx + 1}: ${o.text}`}
                aria-pressed={chosen}
                disabled={disabled || chosen || pickedCorrect}
                onClick={() => {
                  if (picked.length === 0) onFirstChoice(o.verdict);
                  markUsed('choices');
                  setPicked((p) => [...p, o.id]);
                }}
              >
                <span className="support-choice-text">{o.text}</span>
                {chosen && (
                  <span className="support-choice-reason">
                    {VERDICT_ICON[o.verdict]} {o.reason}
                    {en(o.reason_en)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {!pickedCorrect && wrongCount >= 2 && (
          <p className="support-note">정답 보기를 표시했어요.{isBeginner ? ' (The best answer is highlighted.)' : ''}</p>
        )}
        <button
          type="button"
          className="quick-chip support-insert-btn"
          aria-label="고른 보기를 입력창에 넣기"
          disabled={busy || !pickedCorrect || !correct}
          onClick={() => correct && onInsert(correct.text, 'choices')}
        >
          입력창에 넣기
        </button>
      </>
    );
  };

  const renderModel = (m: SupportModel) => (
    <>
      <p className="support-model-text">
        {m.text}
        {en(m.text_en)}
      </p>
      <p className="support-note">
        {m.tip}
        {en(m.tip_en)}
      </p>
      <p className="support-note">
        읽어 본 뒤 내 말로 바꿔 말해 보세요.{isBeginner ? ' (Read it, then say it in your own words.)' : ''}
      </p>
      <button
        type="button"
        className="quick-chip support-insert-btn"
        aria-label="모범 답을 입력창에 넣기"
        disabled={busy}
        onClick={() => onInsert(m.text, 'model')}
      >
        입력창에 넣기
      </button>
    </>
  );

  const stepBody = (type: StepType) => {
    if (type === 'hint' && results.hint) return renderHint(results.hint);
    if (type === 'frame' && results.frame) return renderFrame(results.frame);
    if (type === 'choices' && results.choices) return renderChoices();
    if (type === 'model' && results.model) return renderModel(results.model);
    const waiting = loading === type || (loading === 'starter' && (type === 'frame' || type === 'choices'));
    return waiting ? <p className="support-note">도움을 준비하고 있어요…{isBeginner ? ' (Loading…)' : ''}</p> : null;
  };

  // 초급은 starter 로딩 중에도 문장 틀·보기 선택 자리를 보여 줌
  const visible: StepType[] = isBeginner
    ? STEP_ORDER.filter((t) => opened.includes(t) || ((t === 'frame' || t === 'choices') && loading === 'starter'))
    : STEP_ORDER.filter((t) => opened.includes(t));

  return (
    <div className="support-panel" aria-label="도움 사다리">
      {intent && (
        <p className="support-intent">
          지금 할 말: {intent.ko}
          {isBeginner && intent.en ? <span className="support-en-inline"> (Now: {intent.en})</span> : null}
        </p>
      )}
      {error && (
        <div className="error-banner support-error" role="alert">
          <div>
            {error.kind === 'rate' ? (
              <>잠시 후 다시 시도해 주세요.{isBeginner ? ' (Please try again in a moment.)' : ''}</>
            ) : (
              <>도움을 불러오지 못했어요.{isBeginner ? " (Couldn't load help.)" : ''}</>
            )}
          </div>
          <button
            type="button"
            className="quick-chip"
            aria-label="도움 다시 시도"
            disabled={disabled || loading !== null || rateLimited}
            onClick={() => void request(error.type)}
          >
            다시 시도
          </button>
        </div>
      )}

      {visible.map((t) => (
        <section key={t} className="support-step" aria-label={STEP_LABEL[t].ko}>
          <div className="support-step-title">
            {STEP_LABEL[t].ko}
            {isBeginner ? <span className="support-en-inline"> {STEP_LABEL[t].en}</span> : null}
          </div>
          {stepBody(t)}
        </section>
      ))}

      <div className="support-actions">
        {isBeginner ? (
          (['hint', 'model'] as StepType[])
            .filter((t) => !opened.includes(t))
            .map((t) => (
              <button
                key={t}
                type="button"
                className="quick-chip"
                aria-label={`${STEP_LABEL[t].ko} 보기`}
                disabled={busy}
                onClick={() => openStep(t)}
              >
                {STEP_LABEL[t].ko} <span className="support-en-inline">{STEP_LABEL[t].en}</span>
              </button>
            ))
        ) : nextStep ? (
          level === '고급' ? (
            <button
              type="button"
              className="support-link-btn"
              aria-label={`도움 열기: ${STEP_LABEL[nextStep].ko}`}
              disabled={busy}
              onClick={() => openStep(nextStep)}
            >
              도움이 필요하면 누르세요
            </button>
          ) : (
            <button
              type="button"
              className="quick-chip"
              aria-label={`도움 열기: ${STEP_LABEL[nextStep].ko}`}
              disabled={busy}
              onClick={() => openStep(nextStep)}
            >
              💡 도움
            </button>
          )
        ) : null}
      </div>
    </div>
  );
};

export default RoleplaySupportPanel;
