import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Navigate, useNavigate } from "react-router-dom";
import { z } from "zod";
import { ApiError } from "../api/client";
import { useLogin, useRegister } from "../api/hooks";
import { useTokenStore } from "../stores/tokenStore";

const loginSchema = z.object({
  email: z.string().trim().email("请输入有效的邮箱地址"),
  password: z.string().min(8, "密码至少 8 位"),
});

const registerSchema = loginSchema.extend({
  displayName: z
    .string()
    .trim()
    .min(1, "请输入昵称")
    .max(64, "昵称最多 64 个字符"),
});

type RegisterValues = z.infer<typeof registerSchema>;

type Mode = "login" | "register";

export default function LoginPage() {
  const token = useTokenStore((state) => state.token);
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const isRegister = mode === "register";

  const loginMutation = useLogin();
  const registerMutation = useRegister();
  const mutation = isRegister ? registerMutation : loginMutation;

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<RegisterValues>({
    resolver: zodResolver(isRegister ? registerSchema : loginSchema),
    defaultValues: { email: "", password: "", displayName: "" },
  });

  if (token) {
    return <Navigate to="/rooms" replace />;
  }

  const switchMode = (next: Mode) => {
    setMode(next);
    reset({ email: "", password: "", displayName: "" });
    mutation.reset();
  };

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (isRegister) {
        await registerMutation.mutateAsync({
          email: values.email,
          displayName: values.displayName,
          password: values.password,
        });
      } else {
        await loginMutation.mutateAsync({
          email: values.email,
          password: values.password,
        });
      }
      navigate("/rooms", { replace: true });
    } catch {
      // Error is rendered below from mutation.error.
    }
  });

  const errorMessage = mutation.error
    ? errorText(mutation.error)
    : null;

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-xl">
        <h1 className="mb-1 text-xl font-bold text-text">AgentRoom</h1>
        <p className="mb-5 text-sm text-muted">
          与本地终端和 AI Agent 共享的聊天室
        </p>

        <div className="mb-5 flex rounded-lg border border-border p-0.5 text-sm">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
                mode === m
                  ? "bg-surface-raised font-medium text-text"
                  : "text-muted hover:text-text"
              }`}
            >
              {m === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {isRegister && (
            <Field label="昵称" error={errors.displayName?.message}>
              <input
                type="text"
                autoComplete="nickname"
                className={inputClass}
                placeholder="Alice"
                {...register("displayName")}
              />
            </Field>
          )}
          <Field label="邮箱" error={errors.email?.message}>
            <input
              type="email"
              autoComplete="email"
              className={inputClass}
              placeholder="user@example.com"
              {...register("email")}
            />
          </Field>
          <Field label="密码" error={errors.password?.message}>
            <input
              type="password"
              autoComplete={isRegister ? "new-password" : "current-password"}
              className={inputClass}
              placeholder="至少 8 位"
              {...register("password")}
            />
          </Field>

          {errorMessage && (
            <p className="text-sm text-danger">{errorMessage}</p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full rounded-lg bg-primary px-3 py-2 font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
          >
            {mutation.isPending
              ? "提交中…"
              : isRegister
                ? "创建账号"
                : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted/60 focus:border-primary focus:outline-none";

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
    </label>
  );
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return "尝试过于频繁,请稍后再试";
    }
    if (error.code === "EMAIL_ALREADY_REGISTERED") {
      return "该邮箱已注册,请直接登录";
    }
    return error.message;
  }
  return "请求失败,请检查网络后重试";
}
