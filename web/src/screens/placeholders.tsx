export function Pending({ n, title }: { n: string; title: string }) {
  return (
    <div className="mx-auto max-w-5xl p-8">
      <h1 className="text-4xl">
        {n} {title}
      </h1>
      <p className="mt-2 text-muted">
        Pending · this screen is built in a later phase (see docs/PLAN.md).
      </p>
    </div>
  )
}
