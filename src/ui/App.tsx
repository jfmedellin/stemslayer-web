export function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="wordmark">Stemslayer</span>
        <span className="status" aria-label="Application status">Foundation ready</span>
      </header>
      <main className="workspace" aria-labelledby="workspace-title">
        <p className="eyebrow">Dragon Atelier</p>
        <h1 id="workspace-title">Your workspace is ready.</h1>
        <p>Audio separation tools will appear here in the next phase.</p>
      </main>
    </div>
  )
}
