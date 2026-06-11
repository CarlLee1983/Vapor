import { useEffect, useMemo, useRef, useState } from "react";
import { createGitTag, listGitTags, previewCreateTag, readTagsmithConfig } from "../lib/tauriApi";
import { listTagLines, planNextTag } from "../lib/tagsmith/plan";
import type { GitCommandPreview, GitError, RepositoryState } from "../types/git";
import type { BumpLevel, ConfigSource, TagPlan } from "../types/tagsmith";

interface Props {
  repository: RepositoryState;
  onClose: () => void;
  onCreated: () => void;
}

const LEVELS: BumpLevel[] = ["patch", "minor", "major", "prerelease"];

function configSourceLabel(source: ConfigSource) {
  switch (source) {
    case "file":
      return "Using .tagsmith.json";
    case "inferred":
      return "Inferred semver from existing tags";
    case "default":
      return "Default semver (no .tagsmith.json)";
  }
}

export function CreateTagDialog({ repository, onClose, onCreated }: Props) {
  const [level, setLevel] = useState<BumpLevel>("patch");
  const [lineName, setLineName] = useState<string | undefined>(undefined);
  const [customVersion, setCustomVersion] = useState("");
  const [message, setMessage] = useState("");
  const [push, setPush] = useState(false);
  const [remote, setRemote] = useState(repository.remotes[0]?.name ?? "origin");
  const [tags, setTags] = useState<string[]>([]);
  const [configExists, setConfigExists] = useState(false);
  const [configContent, setConfigContent] = useState<string | null>(null);
  const [plan, setPlan] = useState<TagPlan | null>(null);
  const [preview, setPreview] = useState<GitCommandPreview | null>(null);
  const [error, setError] = useState<GitError | string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const dialogRef = useRef<HTMLElement>(null);

  const configResponse = useMemo(
    () => ({ exists: configExists, content: configContent }),
    [configContent, configExists],
  );

  const tagLines = useMemo(() => {
    if (isLoading) {
      return [];
    }
    try {
      return listTagLines(configResponse, tags);
    } catch {
      return [];
    }
  }, [configResponse, isLoading, tags]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void (async () => {
      try {
        const [nextTags, config] = await Promise.all([
          listGitTags(repository.root),
          readTagsmithConfig(repository.root),
        ]);
        if (cancelled) {
          return;
        }
        setTags(nextTags);
        setConfigExists(config.exists);
        setConfigContent(config.content);
      } catch (value) {
        if (!cancelled) {
          setError(value as GitError);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [repository.root]);

  useEffect(() => {
    if (isLoading || tagLines.length === 0) {
      return;
    }
    setLineName((current) => {
      if (current && tagLines.some((line) => line.name === current)) {
        return current;
      }
      const defaultLine = tagLines.find((line) => line.isDefault) ?? tagLines[0];
      return defaultLine.name;
    });
  }, [isLoading, tagLines]);

  useEffect(() => {
    if (isLoading || !lineName) {
      return;
    }
    const trimmedCustomVersion = customVersion.trim();
    try {
      const nextPlan = planNextTag({
        config: configResponse,
        tags,
        level,
        lineName,
        explicitVersion: trimmedCustomVersion || undefined,
      });
      setPlan(nextPlan);
      setError(null);
    } catch (value) {
      setPlan(null);
      setError(value instanceof Error ? value.message : String(value));
    }
  }, [configResponse, customVersion, isLoading, level, lineName, tags]);

  useEffect(() => {
    let cancelled = false;
    if (!plan) {
      setPreview(null);
      return;
    }
    const trimmedMessage = message.trim();
    void previewCreateTag({
      repositoryPath: repository.root,
      tagName: plan.tag,
      message: trimmedMessage || undefined,
      push: false,
      remote: push ? remote : undefined,
    })
      .then((value) => {
        if (!cancelled) {
          setPreview(value);
        }
      })
      .catch((value) => {
        if (!cancelled) {
          setPreview(null);
          setError(value as GitError);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [message, plan, push, remote, repository.root]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const hasRemotes = repository.remotes.length > 0;
  const pushPreview =
    push && plan && hasRemotes ? `git push ${remote} ${plan.tag}` : null;
  const commandPreview = [preview?.display, pushPreview].filter(Boolean).join("\n");

  async function onSubmit() {
    if (!plan || !preview) {
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      await createGitTag({
        repositoryPath: repository.root,
        tagName: plan.tag,
        message: message.trim() || undefined,
        push,
        remote: push ? remote : undefined,
      });
      onCreated();
      onClose();
    } catch (value) {
      setError(value as GitError);
    } finally {
      setIsCreating(false);
    }
  }

  const usesCustomVersion = customVersion.trim().length > 0;

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="dialog"
        role="dialog"
        aria-label="Create tag"
        aria-modal="true"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !isCreating) onClose();
        }}
      >
        <header className="dialog-header">
          <div>
            <h2>Create Tag</h2>
            <p className="dialog-subtitle">
              {plan ? configSourceLabel(plan.configSource) : "Loading tag specification..."}
            </p>
          </div>
          <button type="button" disabled={isCreating} onClick={onClose}>
            Close
          </button>
        </header>

        {isLoading ? (
          <p role="status">Loading tags and configuration...</p>
        ) : (
          <>
            {tagLines.length > 0 ? (
              <label>
                Tag line
                <select
                  aria-label="Tag line"
                  value={lineName ?? plan?.line ?? ""}
                  onChange={(event) => {
                    const nextLineName = event.target.value;
                    setLineName(nextLineName);
                    const line = tagLines.find((item) => item.name === nextLineName);
                    if (line) {
                      setPush(line.push);
                    }
                  }}
                >
                  {tagLines.map((line) => (
                    <option key={line.name} value={line.name}>
                      {line.name} ({line.pattern})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label>
              Bump level
              <select
                aria-label="Bump level"
                value={level}
                disabled={usesCustomVersion}
                onChange={(event) => setLevel(event.target.value as BumpLevel)}
              >
                {LEVELS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
              {usesCustomVersion ? (
                <span className="field-hint">Disabled while a custom version is set.</span>
              ) : null}
            </label>

            <label>
              Custom version
              <input
                aria-label="Custom version"
                value={customVersion}
                placeholder="e.g. 2.0.0"
                onChange={(event) => setCustomVersion(event.target.value)}
              />
              <span className="field-hint">Optional — like tagsmith --set-version. Leave empty to auto bump.</span>
            </label>

            {plan ? (
              <div className="push-destination" aria-label="Next tag">
                <span>Next tag</span>
                <strong>{plan.tag}</strong>
                <span className="field-hint">
                  {plan.fresh
                    ? "Initial tag"
                    : plan.fromVersion
                      ? `From ${plan.fromVersion}`
                      : null}
                  {plan.latestTag ? ` · Latest ${plan.latestTag}` : null}
                  {plan.anomalyCount > 0 ? ` · ${plan.anomalyCount} non-conforming tag(s) ignored` : null}
                </span>
              </div>
            ) : null}

            <label>
              Annotation message
              <input
                aria-label="Annotation message"
                value={message}
                placeholder="Optional release note"
                onChange={(event) => setMessage(event.target.value)}
              />
              <span className="field-hint">Leave empty for a lightweight tag.</span>
            </label>

            <label className="checkbox-row">
              <input checked={push} type="checkbox" onChange={(event) => setPush(event.target.checked)} />
              Push tag after creating
            </label>

            {push ? (
              <label>
                Remote
                <select
                  aria-label="Remote"
                  value={remote}
                  disabled={!hasRemotes}
                  onChange={(event) => setRemote(event.target.value)}
                >
                  {repository.remotes.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}
                    </option>
                  ))}
                </select>
                {!hasRemotes ? (
                  <span className="field-hint">No remotes configured; tag will be created locally only.</span>
                ) : null}
              </label>
            ) : null}

            <pre className="command-preview">{commandPreview || "Preparing command preview..."}</pre>

            {error ? (
              <div className="error-banner" role="alert">
                {typeof error === "string" ? error : `${error.message} ${error.hint}`}
                {typeof error !== "string" && error.stderr ? <pre>{error.stderr}</pre> : null}
              </div>
            ) : null}

            <footer className="dialog-actions">
              <button type="button" disabled={isCreating} onClick={onClose}>
                Cancel
              </button>
              <button type="button" disabled={!plan || !preview || isCreating || (push && !hasRemotes)} onClick={() => void onSubmit()}>
                {isCreating ? "Creating..." : "Create Tag"}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
