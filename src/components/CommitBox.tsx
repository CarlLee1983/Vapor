import { useRef, useState } from "react";
import type { RepositoryState } from "../types/git";

interface CommitInput {
  message: string;
  amend: boolean;
  signOff: boolean;
}

interface CommitBoxProps {
  repository: RepositoryState;
  hasStagedChanges: boolean;
  onCommit: (input: CommitInput) => Promise<unknown>;
  onPreview: (input: CommitInput) => Promise<{ display: string }>;
  onLoadLastMessage: () => Promise<string>;
}

export function CommitBox({
  repository,
  hasStagedChanges,
  onCommit,
  onPreview,
  onLoadLastMessage,
}: CommitBoxProps) {
  const [message, setMessage] = useState("");
  const [amend, setAmend] = useState(false);
  const [signOff, setSignOff] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [preview, setPreview] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const previewGenRef = useRef(0);

  // amend with an empty message is allowed: the backend commits with --amend --no-edit (reuse prior message).
  const trimmed = message.trim();
  const canCommit = !isCommitting && (amend || (trimmed !== "" && hasStagedChanges));

  const refreshPreview = async (next: Partial<CommitInput> = {}) => {
    // `next` carries the just-changed field because React state updates are async;
    // closure values of amend/signOff are from the previous render.
    const gen = ++previewGenRef.current;
    const input: CommitInput = { message, amend, signOff, ...next };
    if (input.message.trim() === "" && !input.amend) {
      setPreview("");
      return;
    }
    try {
      const result = await onPreview(input);
      if (gen === previewGenRef.current) setPreview(result.display);
    } catch {
      if (gen === previewGenRef.current) setPreview("");
    }
  };

  const handleCommit = async () => {
    setIsCommitting(true);
    setError(null);
    try {
      await onCommit({ message, amend, signOff });
      setMessage("");
      setAmend(false);
      setSignOff(false);
      setAdvancedOpen(false);
      setPreview("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <section className="commit-box" aria-label="Create commit">
      <label className="commit-box__label" htmlFor="commit-message">
        Commit message
      </label>
      <textarea
        id="commit-message"
        className="commit-box__message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        placeholder={`Commit to ${repository.currentBranch ?? "HEAD"}…`}
        rows={3}
      />

      <button
        type="button"
        className="commit-box__advanced-toggle"
        aria-expanded={advancedOpen}
        onClick={() => {
          const next = !advancedOpen;
          setAdvancedOpen(next);
          if (next) {
            void refreshPreview();
          }
        }}
      >
        {advancedOpen ? "▾" : "▸"} Advanced
      </button>

      {advancedOpen ? (
        <div className="commit-box__advanced">
          <label className="commit-box__option commit-box__option--amend">
            <input
              type="checkbox"
              checked={amend}
              onChange={(event) => {
                const checked = event.target.checked;
                setAmend(checked);
                if (checked && message.trim() === "") {
                  void onLoadLastMessage().then(setMessage);
                }
                void refreshPreview({ amend: checked });
              }}
            />
            Amend previous commit
          </label>
          <label className="commit-box__option">
            <input
              type="checkbox"
              checked={signOff}
              onChange={(event) => {
                setSignOff(event.target.checked);
                void refreshPreview({ signOff: event.target.checked });
              }}
            />
            Sign-off (-s)
          </label>
          {preview ? <code className="commit-box__preview">{preview}</code> : null}
        </div>
      ) : null}

      {error ? (
        <p className="commit-box__error" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="commit-box__submit"
        disabled={!canCommit}
        onClick={() => void handleCommit()}
      >
        {isCommitting ? "Committing…" : "Commit"}
      </button>
    </section>
  );
}
