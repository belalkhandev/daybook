export function ComingSoon({ title }: { title: string }) {
  return (
    <>
      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 className="h1">{title}</h1>
      </section>
      <section className="glass card" style={{ gap: 8 }}>
        <h2 className="card-title">Coming soon</h2>
        <p style={{ fontSize: 14, color: "var(--muted)" }}>This view is not designed yet. Today and Notes are ready to use.</p>
      </section>
    </>
  );
}
