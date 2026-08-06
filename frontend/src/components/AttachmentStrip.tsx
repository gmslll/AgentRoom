import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useAttachment, useUploadAttachment } from "../api/hooks";
import type { Attachment } from "../api/types";
import { formatBytes } from "../lib/format";
import { Icon } from "./ui/Icon";

export function AttachmentPicker({
  roomId,
  attachments,
  onChange,
  disabled = false,
}: {
  roomId: string;
  attachments: Attachment[];
  onChange: (attachments: Attachment[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const upload = useUploadAttachment(roomId);
  const [uploadingNames, setUploadingNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const selectFiles = async (files: FileList | null) => {
    if (!files) return;
    const selected = Array.from(files).slice(
      0,
      Math.max(0, 10 - attachments.length),
    );
    setError(null);
    setUploadingNames(selected.map((file) => file.name));
    const completed: Attachment[] = [];
    try {
      for (const file of selected) {
        const result = await upload.mutateAsync(file);
        completed.push(result.attachment);
        setUploadingNames((items) =>
          items.filter((name) => name !== file.name),
        );
      }
      onChange([...attachments, ...completed]);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "附件上传失败",
      );
      if (completed.length) onChange([...attachments, ...completed]);
    } finally {
      setUploadingNames([]);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(event) => void selectFiles(event.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || attachments.length >= 10 || upload.isPending}
        className="button-secondary size-10 shrink-0 p-0 text-muted"
        aria-label="添加图片或文件"
        title="添加图片或文件"
      >
        <Icon name="paperclip" size={17} />
      </button>
      {(attachments.length > 0 || uploadingNames.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {attachments.map((attachment) => (
            <span
              key={attachment.id}
              className="inline-flex max-w-full items-center gap-1.5 border border-border bg-bg/60 px-2 py-1 text-[10px] text-muted"
            >
              <Icon
                name={
                  attachment.mediaType.startsWith("image/")
                    ? "paperclip"
                    : "file"
                }
                size={12}
              />
              <span className="max-w-40 truncate">{attachment.name}</span>
              <button
                type="button"
                onClick={() =>
                  onChange(
                    attachments.filter((item) => item.id !== attachment.id),
                  )
                }
                className="text-muted hover:text-danger"
                aria-label={`移除 ${attachment.name}`}
              >
                <Icon name="close" size={11} />
              </button>
            </span>
          ))}
          {uploadingNames.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 border border-warning/30 bg-warning/5 px-2 py-1 text-[10px] text-warning"
            >
              <span className="size-2 animate-spin rounded-full border border-warning border-t-transparent" />
              {name}
            </span>
          ))}
        </div>
      )}
      {error && <p className="mt-1.5 text-[11px] text-danger">{error}</p>}
    </div>
  );
}

export function AttachmentRefs({
  roomId,
  attachmentIds,
  inverse = false,
}: {
  roomId: string;
  attachmentIds: string[];
  inverse?: boolean;
}) {
  if (attachmentIds.length === 0) return null;
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {attachmentIds.map((attachmentId) => (
        <AttachmentReference
          key={attachmentId}
          roomId={roomId}
          attachmentId={attachmentId}
          inverse={inverse}
        />
      ))}
    </div>
  );
}

function AttachmentReference({
  roomId,
  attachmentId,
  inverse,
}: {
  roomId: string;
  attachmentId: string;
  inverse: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "120px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const query = useAttachment(roomId, attachmentId, visible);
  const base = inverse
    ? "border-black/15 bg-black/5 text-ink"
    : "border-border bg-bg/55 text-text";
  return (
    <div ref={ref} className={`min-h-16 overflow-hidden border ${base}`}>
      {!visible || query.isPending ? (
        <div className="flex h-16 items-center gap-2 px-3 text-[10px] text-muted">
          <span className="size-2 animate-pulse bg-muted" />
          附件引用 {attachmentId.slice(-8)}
        </div>
      ) : query.isError ? (
        <div className="px-3 py-3 text-[10px] text-danger">附件暂不可用</div>
      ) : query.data ? (
        <ResolvedAttachmentView data={query.data} inverse={inverse} />
      ) : null}
    </div>
  );
}

function ResolvedAttachmentView({
  data,
  inverse,
}: {
  data: { attachment: Attachment; downloadUrl: string };
  inverse: boolean;
}) {
  const { attachment, downloadUrl } = data;
  if (attachment.scanState === "flagged")
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-danger">
        <Icon name="shield" size={15} />
        附件已被安全策略拦截
      </div>
    );
  if (attachment.mediaType.startsWith("image/")) {
    return (
      <a
        href={downloadUrl}
        target="_blank"
        rel="noreferrer"
        className="group block"
      >
        <img
          src={downloadUrl}
          alt={attachment.name}
          loading="lazy"
          className="max-h-64 w-full object-cover"
        />
        <span
          className={`flex items-center justify-between px-3 py-2 text-[10px] ${inverse ? "text-ink/70" : "text-muted"}`}
        >
          <span className="truncate">{attachment.name}</span>
          <span>{formatBytes(attachment.size)}</span>
        </span>
      </a>
    );
  }
  return (
    <a
      href={downloadUrl}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 px-3 py-3 hover:bg-primary/5"
    >
      <span className="grid size-8 place-items-center border border-current/15">
        <Icon name="file" size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">
          {attachment.name}
        </span>
        <span
          className={`font-data mt-0.5 block text-[9px] ${inverse ? "text-ink/60" : "text-muted"}`}
        >
          {formatBytes(attachment.size)} · {attachment.mediaType}
        </span>
      </span>
      <Icon name="arrow" size={14} />
    </a>
  );
}
