import { Link, NavLink } from "react-router-dom";
import { useLogout } from "../../api/hooks";
import { useTokenStore } from "../../stores/tokenStore";
import { BrandMark } from "./BrandMark";
import { Icon } from "./Icon";

export function AppShell({
  eyebrow,
  title,
  description,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const user = useTokenStore((state) => state.user);
  const logout = useLogout();

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-bg/92 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center gap-5 px-4 sm:px-6">
          <Link to="/rooms" className="shrink-0" aria-label="AgentRoom 首页">
            <BrandMark />
          </Link>
          <span className="hidden h-7 w-px bg-border md:block" />
          <nav
            className="hidden items-center gap-1 md:flex"
            aria-label="主导航"
          >
            <ShellLink to="/rooms" icon="room" label="聊天室" />
            <ShellLink to="/account" icon="user" label="账号与安全" />
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden text-right sm:block">
              <p className="max-w-48 truncate text-xs font-semibold text-text">
                {user?.displayName ?? "AgentRoom user"}
              </p>
              <p className="font-data max-w-48 truncate text-[9px] text-muted">
                {user?.email ?? ""}
              </p>
            </div>
            <Link
              to="/account"
              className="button-secondary size-9 p-0 md:hidden"
              aria-label="账号设置"
            >
              <Icon name="user" size={16} />
            </Link>
            <button
              type="button"
              onClick={() => logout.mutate()}
              disabled={logout.isPending}
              className="button-secondary h-9 px-3 text-xs text-muted"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-7 sm:px-6 sm:py-10">
        <div className="mb-8 flex flex-col gap-4 border-b border-border/70 pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="eyebrow mb-3">{eyebrow}</p>
            <h1 className="text-balance text-3xl font-extrabold tracking-[-0.05em] text-text sm:text-4xl">
              {title}
            </h1>
            {description && (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
        {children}
      </main>
    </div>
  );
}

function ShellLink({
  to,
  icon,
  label,
}: {
  to: string;
  icon: "room" | "user";
  label: string;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted hover:bg-surface-raised hover:text-text"
        }`
      }
    >
      <Icon name={icon} size={15} />
      {label}
    </NavLink>
  );
}
