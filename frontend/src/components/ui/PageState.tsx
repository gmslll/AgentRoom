export function PageState({
  eyebrow,
  title,
  detail,
  action,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="panel mx-auto flex min-h-56 w-full max-w-xl flex-col items-center justify-center px-8 py-12 text-center">
      {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
      <h2 className="text-balance text-xl font-bold tracking-tight text-text">
        {title}
      </h2>
      {detail && <p className="mt-2 max-w-md text-sm text-muted">{detail}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
