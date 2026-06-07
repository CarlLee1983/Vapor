import "./styles.css";

export default function App() {
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Repositories">
        <div className="sidebar__title">Vapor</div>
      </aside>
      <section className="workspace" aria-label="Git workbench">
        <header className="toolbar">
          <div>
            <strong>No repository selected</strong>
            <span>Open a Git repository to inspect history and push branches.</span>
          </div>
          <button type="button" disabled>
            Push
          </button>
        </header>
        <div className="empty-state">Repository workbench will load here.</div>
      </section>
    </main>
  );
}
