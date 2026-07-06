import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionContext, AppAction } from "../lib/actions";

interface Props {
  actions: AppAction[];
  ctx: ActionContext;
  onClose: () => void;
}

/** Lowercase substring score: 0 = no match; prefix and word-boundary hits score higher. */
export function scoreMatch(title: string, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 1;
  const haystack = title.toLowerCase();
  const index = haystack.indexOf(needle);
  if (index === -1) return 0;
  let score = 10;
  if (index === 0) score += 5; // prefix
  else if (haystack[index - 1] === " " || haystack[index - 1] === "-") score += 3; // word boundary
  score -= index * 0.1; // earlier matches rank higher
  return Math.max(score, 1);
}

export function CommandPalette({ actions, ctx, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const ranked = useMemo(() => {
    return actions
      .map((action) => ({ action, score: scoreMatch(action.title, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.action);
  }, [actions, query]);

  // Clamp the highlight whenever the filtered list shrinks.
  useEffect(() => {
    setHighlight((current) => (current >= ranked.length ? 0 : current));
  }, [ranked.length]);

  const runAt = (index: number) => {
    const action = ranked[index];
    if (!action || action.disabled(ctx)) return;
    action.run();
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlight((current) => (ranked.length ? (current + 1) % ranked.length : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((current) => (ranked.length ? (current - 1 + ranked.length) % ranked.length : 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runAt(highlight);
    }
  };

  return (
    <div className="dialog-backdrop command-palette-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="command-palette"
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          type="text"
          className="command-palette__input"
          placeholder="Type a command…"
          aria-label="Command palette search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
        />
        <ul className="command-palette__list" role="listbox">
          {ranked.map((action, index) => {
            const disabled = action.disabled(ctx);
            return (
              <li key={action.id} role="option" aria-selected={index === highlight}>
                <button
                  type="button"
                  className={`command-palette__item${index === highlight ? " command-palette__item--active" : ""}`}
                  aria-disabled={disabled}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => runAt(index)}
                >
                  <span>{action.title}</span>
                  {disabled ? <span className="command-palette__hint">(unavailable)</span> : null}
                </button>
              </li>
            );
          })}
          {ranked.length === 0 ? <li className="command-palette__empty">No matching commands</li> : null}
        </ul>
      </section>
    </div>
  );
}
