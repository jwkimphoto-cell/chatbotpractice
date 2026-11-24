import React, { useEffect, useRef, useState } from 'react';
import { ChatApiError, streamChatMessage, type ChatMessage, type RoleplayLevel, type SupportType } from '../api/chat';
import {
  alignFrameWithAnswer,
  beginnerSupportIssue,
  koreanInEnglishFields,
  extractSupport,
  normalizeUtterance,
  repeatsLearner,
  replyToMatches,
  supportLengthIssue,
  type SupportChoiceOption,
  type SupportChoicesBody,
  type SupportData,
  type SupportFrameBody,
  type SupportHint,
  type SupportModel,
  type SupportFailKind,
  type SupportVerdict,
} from '../utils/meta';
import { choiceState } from '../utils/chatState';

/**
 * 롤플레이 도움 사다리 패널 (💡 방향 힌트 → ✏️ 문장 틀 → 🔘 보기 선택 → 👀 모범 답)
 * - 부모가 상대역 발화마다 key를 바꿔 새로 마운트함 → 이전 턴의 도움은 자동으로 사라짐
 * - 부모는 상대역 응답 스트리밍이 끝나고 내용이 비어 있지 않을 때만 이 패널을 마운트함
 * - 요청 직전에 getHistory()로 최신 대화 기록을 읽고, 마지막 상대역 발화가 targetText와 같을 때만 보냄
 * - 응답의 replyTo가 다르거나 보기·힌트 등에 {{n}}이 있거나 초급 범위 점검(beginnerSupportIssue)에 걸리면 버리고 자동으로 한 번만 다시 요청함 (두 번째도 실패하면 [다시 시도])
 * - starter는 어떤 실패든 한 번 다시 요청하고, 2번 연속 실패하면 frame과 choices를 따로 1번씩 요청함(대체 경로)
 *   단, 첫 실패가 문장 틀의 빈칸 개수 오류나 빈칸이 문장 끝인 오류면 다시 요청하지 않고 바로 대체 경로로 감
 * - 실패하면 개발 모드에서 console.warn으로 분류·종류·마지막 상대역 발화·응답 앞 300자를 남김 (화면에는 원문을 보이지 않음)
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
/** 실패 분류 (개발 모드 로그용) */
type FailKind = 'http' | 'replyTo' | 'level' | 'repeat' | 'length' | SupportFailKind;
/** soft: 길이만 넘은 중급·고급 도움. 다시 요청해도 넘으면 버리지 않고 보여 줌 (화면 안정성 우선) */
type FetchResult = { ok: true; data: SupportData } | { ok: false; kind: FailKind; error?: string; soft?: SupportData } | { ok: false; kind: 'skip' };
/** 자동으로 한 번 다시 요청하는 실패 (starter는 모든 실패를 다시 요청, frame·choices는 구조 오류도 다시 요청) */
const RETRY_KINDS: FailKind[] = ['placeholder', 'replyTo', 'level', 'repeat', 'length'];

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

  // 🔘 보기 선택 상태 (처음과 새 보기를 받을 때는 선택 없음 = 빈 배열)
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
      setPicked([]);
      setOpened((o) => [...new Set([...o, 'frame' as StepType, 'choices' as StepType])]);
    } else if (data.type === 'choices') {
      setResults((r) => ({ ...r, choices: { options: data.options } }));
      setChoiceOrder(shuffle(data.options));
      setPicked([]);
    } else if (data.type === 'frame') {
      setResults((r) => ({ ...r, frame: { template: data.template, blanks: data.blanks } }));
    } else if (data.type === 'hint') {
      setResults((r) => ({ ...r, hint: data }));
    } else {
      setResults((r) => ({ ...r, model: data }));
    }
  };

  /** 실패 사유 기록 (개발 모드) */
  const logFail = (kind: FailKind, type: SupportType, lastText: string, raw: string, detail: string) => {
    if (!import.meta.env.DEV) return;
    console.warn('[RoleplaySupport] 도움 실패', {
      분류: kind === 'schema' ? `schema:${detail}` : kind,
      상세: detail,
      supportType: type,
      마지막상대역발화: lastText,
      응답앞300자: raw.slice(0, 300),
    });
  };

  /**
   * 한 번 요청하고 검증까지. 429는 그대로 던짐(바깥에서 "잠시 후" 안내).
   * 요청 직전에 getHistory()로 최신 기록을 읽고, 마지막 상대역 발화가 이 패널의 대상과 다르면 보내지 않음(skip)
   */
  const fetchOnce = async (type: SupportType, frameTemplate?: string): Promise<FetchResult> => {
    const history = getHistory();
    const last = history[history.length - 1];
    if (!last || last.role !== 'assistant' || !last.content.trim() || normalizeUtterance(last.content) !== normalizeUtterance(targetText)) {
      console.warn('[RoleplaySupport] 마지막 상대역 발화가 이 도움의 대상과 달라 요청하지 않음');
      return { ok: false, kind: 'skip' };
    }
    if (import.meta.env.DEV) console.debug(`[RoleplaySupport] 도움 요청(${type}) — 마지막 상대역 발화:`, last.content);
    console.info(`[RoleplaySupport] API 요청: ${type}`);
    let reply = '';
    try {
      reply = await streamChatMessage(history, () => {}, { mode: 'roleplay_support', sceneId, level, supportType: type, frameTemplate });
    } catch (e) {
      if (e instanceof ChatApiError && e.status === 429) throw e;
      logFail('http', type, last.content, '', e instanceof ChatApiError ? `status ${e.status}` : String(e));
      return { ok: false, kind: 'http' };
    }
    const parsed = extractSupport(reply, type);
    if (!parsed.ok) {
      logFail(parsed.kind, type, last.content, reply, parsed.error);
      return { ok: false, kind: parsed.kind, error: parsed.error };
    }
    if (!replyToMatches(parsed.data.replyTo, targetText)) {
      logFail('replyTo', type, last.content, reply, `replyTo="${parsed.data.replyTo}"`);
      return { ok: false, kind: 'replyTo' };
    }
    // 초급: 범위 밖 이유 문형, '-ㅂ/습니다'를 탓하는 보기
    const issue = isBeginner ? beginnerSupportIssue(parsed.data) : null;
    if (issue) {
      logFail('level', type, last.content, reply, issue);
      return { ok: false, kind: 'level' };
    }
    // 학습자가 이미 말한 문장을 다시 넣은 도움 (대답 대상 규칙 위반)
    const learnerSaid = history.filter((m) => m.role === 'user').map((m) => m.content);
    const repeat = repeatsLearner(parsed.data, learnerSaid);
    if (repeat) {
      logFail('repeat', type, last.content, reply, repeat);
      return { ok: false, kind: 'repeat' };
    }
    // 중급·고급: 문장당 최대 어절
    const long = isBeginner ? null : supportLengthIssue(parsed.data, level);
    if (long) {
      logFail('length', type, last.content, reply, long);
      return { ok: false, kind: 'length', soft: parsed.data };
    }
    // 영어 칸의 한글: 실패로 처리하지 않고 기록만 (개발 모드)
    const koInEn = isBeginner ? koreanInEnglishFields(parsed.data) : [];
    if (koInEn.length > 0 && import.meta.env.DEV) console.warn('[RoleplaySupport] 영어 칸에 한글이 섞임 (표시는 그대로)', koInEn);
    return { ok: true, data: parsed.data };
  };

  /** 도움 요청 (한 번에 하나만). 캐시가 있으면 API를 부르지 않음. [다시 시도]도 이 함수로 최신 기록을 다시 읽어 보냄 */
  const request = async (type: SupportType, alreadyLoading = false) => {
    const cacheKey = `${turnKey}:${type}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      console.info(`[RoleplaySupport] 캐시 사용: ${type} (API 호출 없음)`);
      applyData(cached);
      // 초급 자동 starter는 처음부터 로딩 상태로 시작하므로, 캐시로 끝나도 로딩을 풀어 줌
      if (alreadyLoading && !inFlightRef.current) setLoading(null);
      return;
    }
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (!alreadyLoading) setLoading(type);
    setError(null);
    try {
      let r = await fetchOnce(type);
      // starter의 문장 틀 빈칸 개수 오류·빈칸이 문장 끝인 오류는 같은 요청을 다시 보내도 반복되는 경우가 많아 재요청 없이 바로 대체 경로로 감
      const skipRetry =
        type === 'starter' && !r.ok && r.kind === 'schema' && 'error' in r && /빈칸 개수|빈칸이 문장 끝/.test(r.error ?? '');
      if (skipRetry) console.info('[RoleplaySupport] starter 문장 틀 빈칸 오류 → 재요청 없이 대체 경로로');
      const retryable = !r.ok && r.kind !== 'skip' && (RETRY_KINDS.includes(r.kind) || type === 'starter' || ((type === 'frame' || type === 'choices') && r.kind === 'schema'));
      if (retryable && !skipRetry) {
        console.info(`[RoleplaySupport] ${type} 실패(${r.ok ? '' : r.kind}) → 한 번 다시 요청`);
        const first = r;
        r = await fetchOnce(type);
        // 두 번 모두 길이만 넘었으면 버리지 않고 마지막 결과를 보여 줌
        if (!r.ok && r.kind === 'length' && 'soft' in r && r.soft) r = { ok: true, data: r.soft };
        else if (!r.ok && r.kind !== 'skip' && !first.ok && first.kind === 'length' && 'soft' in first && first.soft && r.kind !== 'replyTo') r = { ok: true, data: first.soft };
      }
      if (r.ok) {
        cache.set(cacheKey, r.data);
        applyData(r.data);
        return;
      }
      if (r.kind === 'skip') return;

      // 대체 경로: starter가 2번 연속 실패하면 문장 틀과 보기 선택을 따로 1번씩 요청
      if (type === 'starter') {
        console.info('[RoleplaySupport] starter 2회 실패 → 문장 틀·보기 선택을 따로 요청');
        const f = await fetchOnce('frame');
        if (!f.ok && f.kind === 'skip') return;
        // 보기를 요청할 때 방금 받은 문장 틀을 같이 보내 정답 보기를 그 틀에 맞추게 함
        const c = f.ok && f.data.type === 'frame' ? await fetchOnce('choices', f.data.template) : null;
        if (f.ok && c && c.ok && f.data.type === 'frame' && c.data.type === 'choices') {
          const answer = c.data.options.find((o) => o.verdict === 'appropriate')?.text ?? '';
          const aligned = alignFrameWithAnswer({ template: f.data.template, blanks: f.data.blanks }, answer);
          if (!aligned.matched && import.meta.env.DEV) {
            console.warn('[RoleplaySupport] 대체 경로: 문장 틀과 정답 보기의 구조가 다름', { 틀: f.data.template, 정답보기: answer });
          }
          const combined: SupportData = {
            type: 'starter',
            replyTo: f.data.replyTo,
            intent: f.data.intent || c.data.intent,
            intent_en: f.data.intent_en || c.data.intent_en,
            frame: aligned.frame,
            choices: { options: c.data.options },
          };
          cache.set(cacheKey, combined);
          applyData(combined);
          return;
        }
        if (c && !c.ok && c.kind === 'skip') return;
      }
      setError({ kind: 'parse', type });
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
    const correct = choiceOrder.find((o) => o.verdict === 'appropriate');
    const { pickedCorrect, highlightCorrect, canInsert } = choiceState(choiceOrder, picked);
    return (
      <>
        <div className="support-choice-list" role="group" aria-label="보기 선택">
          {choiceOrder.map((o, idx) => {
            const chosen = picked.includes(o.id);
            const highlight = highlightCorrect && o.verdict === 'appropriate';
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
        {highlightCorrect && (
          <p className="support-note">정답 보기를 표시했어요.{isBeginner ? ' (The best answer is highlighted.)' : ''}</p>
        )}
        <button
          type="button"
          className="quick-chip support-insert-btn"
          aria-label="고른 보기를 입력창에 넣기"
          disabled={busy || !canInsert || !correct}
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
