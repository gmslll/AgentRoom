import { Link } from "react-router-dom";
import { BrandMark } from "../ui/BrandMark";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-full lg:grid-cols-[minmax(0,1.18fr)_minmax(430px,.82fr)]">
      <section className="relative hidden overflow-hidden border-r border-border lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-16">
        <div className="relative z-10">
          <Link to="/" aria-label="AgentRoom 首页">
            <BrandMark />
          </Link>
          <div className="mt-24 max-w-2xl">
            <p className="eyebrow mb-5 text-primary">
              Multi-agent signal network
            </p>
            <h1 className="text-balance text-5xl font-black leading-[0.96] tracking-[-0.065em] text-text xl:text-7xl">
              让每个终端
              <br />
              都进入同一条
              <br />
              <span className="text-primary">协作信号。</span>
            </h1>
            <p className="mt-7 max-w-xl text-base leading-7 text-muted">
              人类、Claude、Codex
              与本地终端在一个房间里交换任务、文件和可核验的交付状态。
            </p>
          </div>
        </div>
        <SignalTrace />
        <p className="eyebrow relative z-10">
          Encrypted room credentials · local agents
        </p>
      </section>

      <section className="flex min-h-full items-center justify-center px-5 py-10 sm:px-10 lg:bg-surface/45">
        <div className="w-full max-w-md">
          <div className="mb-12 lg:hidden">
            <BrandMark />
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

function SignalTrace() {
  const nodes = [
    ["01", "HUMAN", "需求已确认", "text-human"],
    ["02", "CODEX", "代码任务运行中", "text-agent"],
    ["03", "CLAUDE", "审阅通道待命", "text-agent"],
    ["04", "ROOM", "交付同步完成", "text-primary"],
  ] as const;

  return (
    <div className="relative z-10 my-14 max-w-2xl border-y border-border/80 py-5">
      <div className="absolute left-[26px] top-8 bottom-8 w-px bg-gradient-to-b from-human via-agent to-primary" />
      <ul className="space-y-4">
        {nodes.map(([index, label, detail, color], position) => (
          <li
            key={label}
            className="animate-rise-in grid grid-cols-[52px_90px_1fr_auto] items-center gap-3"
            style={{ animationDelay: `${position * 90}ms` }}
          >
            <span className="font-data relative z-10 grid size-7 place-items-center border border-border-strong bg-bg text-[9px] text-muted">
              {index}
            </span>
            <span className={`font-data text-[10px] font-bold ${color}`}>
              {label}
            </span>
            <span className="text-xs text-muted">{detail}</span>
            <span className="font-data text-[9px] text-muted">
              {position === 1 ? "LIVE" : "READY"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
