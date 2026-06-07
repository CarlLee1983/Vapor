interface Props {
  diff: string;
}

export function DiffViewer({ diff }: Props) {
  return (
    <section className="panel diff-viewer" aria-label="Diff">
      <h2>Diff</h2>
      <pre>{diff || "Select a commit or file to inspect a diff."}</pre>
    </section>
  );
}
