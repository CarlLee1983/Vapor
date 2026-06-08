interface Props {
  diff: string;
}

export function DiffViewer({ diff }: Props) {
  if (!diff) {
    return (
      <section className="panel diff-viewer" aria-label="Diff">
        <h2>Diff</h2>
        <div className="diff-empty">Select a commit or file to inspect a diff.</div>
      </section>
    );
  }

  const lines = diff.split("\n");

  return (
    <section className="panel diff-viewer" aria-label="Diff">
      <h2>Diff</h2>
      <pre className="diff-code">
        {lines.map((line, idx) => {
          let className = "diff-line";
          if (line.startsWith("+")) {
            className = "diff-line diff-added";
          } else if (line.startsWith("-")) {
            className = "diff-line diff-deleted";
          } else if (line.startsWith("@@")) {
            className = "diff-line diff-hunk";
          }
          return (
            <div key={idx} className={className}>
              {line}
            </div>
          );
        })}
      </pre>
    </section>
  );
}
