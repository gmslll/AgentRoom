export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="relative grid size-9 shrink-0 place-items-center border border-primary/50 bg-primary/10 text-primary">
        <span className="absolute -right-1 -top-1 size-2 bg-primary shadow-[0_0_12px_rgba(199,243,107,.7)]" />
        <span className="font-data text-xs font-bold">AR</span>
      </span>
      {!compact && (
        <span className="min-w-0">
          <span className="block text-[15px] font-extrabold tracking-[-0.035em] text-text">
            AgentRoom
          </span>
          <span className="eyebrow block text-[8px]">Signal operations</span>
        </span>
      )}
    </div>
  );
}
