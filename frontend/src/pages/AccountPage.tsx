import { useState } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  useChangePassword,
  useRequestEmailVerification,
  useVerifyEmail,
} from "../api/hooks";
import { AppShell } from "../components/ui/AppShell";
import { Icon } from "../components/ui/Icon";
import { features } from "../config/features";
import { formatDate } from "../lib/time";
import { useTokenStore } from "../stores/tokenStore";

export default function AccountPage() {
  const token = useTokenStore((state) => state.token);
  const user = useTokenStore((state) => state.user);
  if (!token) return <Navigate to="/login" replace />;

  return (
    <AppShell
      eyebrow="Account control"
      title="账号与安全"
      description="管理邮箱验证和登录凭证。Agent 与房间授权在对应房间内单独管理。"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,.72fr)]">
        <section className="panel cut-corner p-6 sm:p-8">
          <div className="flex items-start gap-4">
            <span className="grid size-12 shrink-0 place-items-center border border-human/40 bg-human/10 text-human">
              <Icon name="user" size={22} />
            </span>
            <div className="min-w-0">
              <p className="eyebrow">Human operator</p>
              <h2 className="mt-2 truncate text-2xl font-bold tracking-tight text-text">
                {user?.displayName}
              </h2>
              <p className="font-data mt-1 truncate text-xs text-muted">
                {user?.email}
              </p>
            </div>
          </div>
          <dl className="mt-8 grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-2">
            <Info label="账号建立" value={formatDate(user?.createdAt ?? "")} />
            <Info
              label="邮箱状态"
              value={user?.emailVerifiedAt ? "已验证" : "未验证"}
              accent={Boolean(user?.emailVerifiedAt)}
            />
          </dl>

          {features.emailAuth && !user?.emailVerifiedAt && (
            <EmailVerification />
          )}
        </section>

        {features.emailAuth && <PasswordPanel />}
      </div>
    </AppShell>
  );
}

function Info({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="bg-surface px-4 py-4">
      <dt className="eyebrow text-[9px]">{label}</dt>
      <dd
        className={`mt-2 text-sm font-semibold ${accent ? "text-primary" : "text-text"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function EmailVerification() {
  const [code, setCode] = useState("");
  const request = useRequestEmailVerification();
  const verify = useVerifyEmail();
  return (
    <div className="mt-7 border-t border-border pt-6">
      <div className="flex items-center gap-2">
        <Icon name="mail" size={17} className="text-warning" />
        <h3 className="font-semibold text-text">验证账号邮箱</h3>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">
        发送一次性验证码后，在这里完成验证。
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          className="field-control h-10 min-w-0 flex-1 px-3 font-data text-xs"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="输入验证码"
        />
        <button
          type="button"
          className="button-secondary h-10 px-3 text-xs"
          onClick={() => request.mutate()}
          disabled={request.isPending}
        >
          {request.isPending
            ? "发送中…"
            : request.isSuccess
              ? "重新发送"
              : "发送验证码"}
        </button>
        <button
          type="button"
          className="button-primary h-10 px-4 text-xs"
          onClick={() => verify.mutate(code.trim())}
          disabled={verify.isPending || code.trim().length < 6}
        >
          确认验证
        </button>
      </div>
      {(request.error || verify.error) && (
        <p className="mt-2 text-xs text-danger">
          {errorText(request.error ?? verify.error)}
        </p>
      )}
      {request.isSuccess && !verify.isSuccess && (
        <p className="mt-2 text-xs text-primary">
          验证邮件已受理，请检查邮箱。
        </p>
      )}
    </div>
  );
}

function PasswordPanel() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const change = useChangePassword();
  const mismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword;
  return (
    <section className="panel-soft p-6 sm:p-8">
      <div className="flex items-center gap-2">
        <Icon name="shield" size={18} className="text-primary" />
        <h2 className="text-lg font-bold text-text">修改密码</h2>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted">
        修改成功后，除当前会话外的账号 session 会被撤销。
      </p>
      <form
        className="mt-6 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          change.mutate(
            { currentPassword, newPassword },
            {
              onSuccess: () => {
                setCurrentPassword("");
                setNewPassword("");
                setConfirmPassword("");
              },
            },
          );
        }}
      >
        <PasswordInput
          label="当前密码"
          value={currentPassword}
          onChange={setCurrentPassword}
          autoComplete="current-password"
        />
        <PasswordInput
          label="新密码"
          value={newPassword}
          onChange={setNewPassword}
          autoComplete="new-password"
        />
        <PasswordInput
          label="确认新密码"
          value={confirmPassword}
          onChange={setConfirmPassword}
          autoComplete="new-password"
        />
        {mismatch && (
          <p className="text-xs text-danger">两次输入的新密码不一致</p>
        )}
        {change.error && (
          <p className="text-xs text-danger">{errorText(change.error)}</p>
        )}
        {change.isSuccess && (
          <p className="text-xs text-primary">
            密码已更新，其他 session 已撤销。
          </p>
        )}
        <button
          className="button-primary h-11 w-full px-4"
          disabled={
            change.isPending ||
            mismatch ||
            currentPassword.length < 8 ||
            newPassword.length < 8
          }
        >
          {change.isPending ? "更新中…" : "更新密码"}
        </button>
      </form>
    </section>
  );
}

function PasswordInput({
  label,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold text-muted">
        {label}
      </span>
      <input
        className="field-control h-11 px-3"
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function errorText(error: unknown): string {
  return error instanceof ApiError ? error.message : "操作失败，请稍后重试";
}
