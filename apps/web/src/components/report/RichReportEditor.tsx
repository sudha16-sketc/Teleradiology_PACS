"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading1,
  Heading2,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Pilcrow,
  Redo2,
  Table,
  Trash2,
  Underline,
  Undo2,
} from "lucide-react";
import { clsx } from "clsx";
import { apiClient } from "@/lib/api-client";
import {
  escapeHtml,
  sanitizeReportHtml,
} from "@/lib/report-html";
import type { ReportImage } from "@axis/types";

interface RichReportEditorProps {
  value: string;
  onChange: (html: string) => void;
  studyUid?: string;
  disabled?: boolean;
  enableImages?: boolean;
  placeholder?: string;
  minHeight?: number;
  onUploadingChange?: (uploading: boolean) => void;
}

function ToolbarButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      className="flex h-8 min-w-8 items-center justify-center rounded border border-border bg-surface px-2 text-text-primary transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function parseWidthPercent(image: HTMLImageElement): string {
  const raw = image.style.width || image.getAttribute("width") || "100";
  const match = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (!match) return "100";
  const n = Number(match[1]);
  return n > 0 ? String(Math.min(100, Math.round(n))) : "100";
}

export function RichReportEditor({
  value,
  onChange,
  studyUid,
  disabled = false,
  enableImages = true,
  placeholder = "Start writing the report...",
  minHeight = 360,
  onUploadingChange,
}: RichReportEditorProps) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const lastEmittedRef = useRef(value);
  const initializedRef = useRef(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(
    null,
  );
  const [caption, setCaption] = useState("");
  const [imageWidth, setImageWidth] = useState("100");

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    const next = sanitizeReportHtml(value ?? "");
    if (!initializedRef.current) {
      el.innerHTML = next;
      lastEmittedRef.current = value ?? "";
      initializedRef.current = true;
      return;
    }
    if (value !== lastEmittedRef.current && !el.contains(document.activeElement)) {
      el.innerHTML = next;
      lastEmittedRef.current = value ?? "";
      setSelectedImage(null);
    }
  }, [value]);

  const emit = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    lastEmittedRef.current = el.innerHTML;
    onChange(el.innerHTML);
  }, [onChange]);

  const focusEditor = () => {
    editorRef.current?.focus();
  };

  const exec = useCallback(
    (command: string, arg?: string) => {
      if (disabled) return;
      focusEditor();
      document.execCommand(command, false, arg);
      emit();
    },
    [disabled, emit],
  );

  const insertHtml = useCallback(
    (html: string) => {
      if (disabled) return;
      focusEditor();
      document.execCommand("insertHTML", false, html);
      emit();
    },
    [disabled, emit],
  );

  const insertTable = () => {
    const rows = Array.from({ length: 3 })
      .map(
        () =>
          `<tr>${Array.from({ length: 3 })
            .map(
              () =>
                '<td style="border:1px solid #9a9a9a;padding:6px;min-width:90px">&nbsp;</td>',
            )
            .join("")}</tr>`,
      )
      .join("");
    insertHtml(
      `<table style="width:100%;border-collapse:collapse;margin:8px 0"><tbody>${rows}</tbody></table><p><br /></p>`,
    );
  };

  const insertImage = (url: string, captionText: string) => {
    const captionHtml = captionText
      ? `<figcaption style="font-size:11px;color:#555;text-align:center;margin-top:4px">${escapeHtml(
          captionText,
        )}</figcaption>`
      : "";
    insertHtml(
      `<figure style="margin:12px 0;text-align:center"><img src="${escapeHtml(
        url,
      )}" alt="${escapeHtml(captionText || "Report image")}" loading="lazy" decoding="async" style="width:100%;height:auto;display:inline-block" />${captionHtml}</figure><p><br /></p>`,
    );
  };

  const handleFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !studyUid) return;

    setUploadError(null);
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      setUploadError("Only PNG, JPEG, GIF or WebP images are supported.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("Image exceeds the 10MB upload limit.");
      return;
    }

    setUploading(true);
    onUploadingChange?.(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiClient.post<{ data: ReportImage & { url: string } }>(
        `/reports/${encodeURIComponent(studyUid)}/images`,
        form,
      );
      const label = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
      insertImage(res.data.url, label);
    } catch (error) {
      setUploadError(
        (error as { message?: string }).message ?? "Image upload failed.",
      );
    } finally {
      setUploading(false);
      onUploadingChange?.(false);
    }
  };

  const handleEditorClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "IMG") {
      const image = target as HTMLImageElement;
      setSelectedImage(image);
      setImageWidth(parseWidthPercent(image));
      const figure = image.closest("figure");
      setCaption(figure?.querySelector("figcaption")?.textContent ?? "");
      return;
    }
    setSelectedImage(null);
  };

  const applyImageWidth = (width: string) => {
    if (!selectedImage) return;
    selectedImage.style.width = `${width}%`;
    selectedImage.style.height = "auto";
    setImageWidth(width);
    emit();
  };

  const applyImageAlign = (align: "left" | "center" | "right") => {
    if (!selectedImage) return;
    const figure = selectedImage.closest("figure");
    const container = figure ?? selectedImage;
    (container as HTMLElement).style.textAlign = align;
    selectedImage.style.display = "inline-block";
    emit();
  };

  const applyCaption = () => {
    if (!selectedImage) return;
    let figure = selectedImage.closest("figure");
    if (!figure) {
      figure = document.createElement("figure");
      figure.style.margin = "12px 0";
      figure.style.textAlign = "center";
      selectedImage.parentNode?.insertBefore(figure, selectedImage);
      figure.appendChild(selectedImage);
    }
    let figcaption = figure.querySelector("figcaption");
    if (!caption.trim()) {
      figcaption?.remove();
    } else {
      if (!figcaption) {
        figcaption = document.createElement("figcaption");
        figcaption.style.fontSize = "11px";
        figcaption.style.color = "#555";
        figcaption.style.textAlign = "center";
        figcaption.style.marginTop = "4px";
        figure.appendChild(figcaption);
      }
      figcaption.textContent = caption;
    }
    emit();
  };

  const removeSelectedImage = () => {
    if (!selectedImage) return;
    const figure = selectedImage.closest("figure");
    if (figure) figure.remove();
    else selectedImage.remove();
    setSelectedImage(null);
    setCaption("");
    emit();
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const html = event.clipboardData.getData("text/html");
    if (!html) return;
    event.preventDefault();
    const sanitized = sanitizeReportHtml(html)
      .replace(/<img[^>]*>/gi, (tag) =>
        /src\s*=\s*["']?\/api\/reports\/images\//i.test(tag) ? tag : "",
      )
      .replace(/<figure[^>]*>\s*<\/figure>/gi, "");
    document.execCommand("insertHTML", false, sanitized);
    emit();
  };

  return (
    <div
      className={clsx(
        "overflow-hidden rounded-md border border-border bg-editor",
        disabled && "opacity-75",
      )}
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface-raised px-2 py-2">
        <ToolbarButton label="Bold" onClick={() => exec("bold")} disabled={disabled}>
          <Bold size={14} />
        </ToolbarButton>
        <ToolbarButton label="Italic" onClick={() => exec("italic")} disabled={disabled}>
          <Italic size={14} />
        </ToolbarButton>
        <ToolbarButton
          label="Underline"
          onClick={() => exec("underline")}
          disabled={disabled}
        >
          <Underline size={14} />
        </ToolbarButton>
        <span className="mx-1 h-6 w-px bg-border" />
        <ToolbarButton
          label="Paragraph"
          onClick={() => exec("formatBlock", "p")}
          disabled={disabled}
        >
          <Pilcrow size={14} />
        </ToolbarButton>
        <ToolbarButton
          label="Heading 1"
          onClick={() => exec("formatBlock", "h1")}
          disabled={disabled}
        >
          <Heading1 size={14} />
        </ToolbarButton>
        <ToolbarButton
          label="Heading 2"
          onClick={() => exec("formatBlock", "h2")}
          disabled={disabled}
        >
          <Heading2 size={14} />
        </ToolbarButton>
        <select
          aria-label="Font size"
          disabled={disabled}
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) exec("fontSize", e.target.value);
            e.target.value = "";
          }}
          className="h-8 rounded border border-border bg-surface px-1 text-xs text-text-primary"
        >
          <option value="">Size</option>
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="4">Medium</option>
          <option value="5">Large</option>
          <option value="6">Heading</option>
          <option value="7">Title</option>
        </select>
        <ToolbarButton
          label="Align left"
          onClick={() => exec("justifyLeft")}
          disabled={disabled}
        >
          <AlignLeft size={14} />
        </ToolbarButton>
        <ToolbarButton
          label="Align center"
          onClick={() => exec("justifyCenter")}
          disabled={disabled}
        >
          <AlignCenter size={14} />
        </ToolbarButton>
        <ToolbarButton
          label="Align right"
          onClick={() => exec("justifyRight")}
          disabled={disabled}
        >
          <AlignRight size={14} />
        </ToolbarButton>
        <span className="mx-1 h-6 w-px bg-border" />
        <ToolbarButton
          label="Bullet list"
          onClick={() => exec("insertUnorderedList")}
          disabled={disabled}
        >
          <List size={14} />
        </ToolbarButton>
        <ToolbarButton
          label="Numbered list"
          onClick={() => exec("insertOrderedList")}
          disabled={disabled}
        >
          <ListOrdered size={14} />
        </ToolbarButton>
        <ToolbarButton label="Insert table" onClick={insertTable} disabled={disabled}>
          <Table size={14} />
        </ToolbarButton>
        {enableImages && (
          <ToolbarButton
            label="Insert image"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || uploading || !studyUid}
          >
            {uploading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ImagePlus size={14} />
            )}
          </ToolbarButton>
        )}
        <span className="mx-1 h-6 w-px bg-border" />
        <ToolbarButton label="Undo" onClick={() => exec("undo")} disabled={disabled}>
          <Undo2 size={14} />
        </ToolbarButton>
        <ToolbarButton label="Redo" onClick={() => exec("redo")} disabled={disabled}>
          <Redo2 size={14} />
        </ToolbarButton>
      </div>

      {enableImages && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          className="hidden"
          onChange={handleFileSelected}
        />
      )}

      {selectedImage && !disabled && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 text-xs text-text-primary">
          <span className="font-medium">Image:</span>
          <span className="text-text-muted">Width</span>
          {["25", "50", "75", "100"].map((width) => (
            <button
              key={width}
              type="button"
              onClick={() => applyImageWidth(width)}
              className={clsx(
                "rounded border px-2 py-1",
                imageWidth === width
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-surface hover:bg-surface-raised",
              )}
            >
              {width}%
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-border" />
          <button
            type="button"
            onClick={() => applyImageAlign("left")}
            className="rounded border border-border px-2 py-1 hover:bg-surface-raised"
          >
            Left
          </button>
          <button
            type="button"
            onClick={() => applyImageAlign("center")}
            className="rounded border border-border px-2 py-1 hover:bg-surface-raised"
          >
            Center
          </button>
          <button
            type="button"
            onClick={() => applyImageAlign("right")}
            className="rounded border border-border px-2 py-1 hover:bg-surface-raised"
          >
            Right
          </button>
          <span className="mx-1 h-4 w-px bg-border" />
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Image caption"
            className="min-w-40 flex-1 rounded border border-border bg-editor px-2 py-1 text-text-primary"
          />
          <button
            type="button"
            onClick={applyCaption}
            className="rounded bg-accent px-2 py-1 text-background hover:bg-accent/90"
          >
            Apply caption
          </button>
          <button
            type="button"
            onClick={removeSelectedImage}
            className="rounded border border-error/40 px-2 py-1 text-error hover:bg-error/10"
          >
            <Trash2 size={12} className="inline" /> Remove
          </button>
        </div>
      )}

      {uploadError && (
        <p className="border-b border-border bg-error/10 px-3 py-1.5 text-xs text-error">
          {uploadError}
        </p>
      )}

      <div
        ref={editorRef}
        role="textbox"
        aria-multiline="true"
        aria-label="Report body"
        contentEditable={!disabled}
        suppressContentEditableWarning
        onInput={emit}
        onClick={handleEditorClick}
        onPaste={handlePaste}
        data-placeholder={placeholder}
        className={clsx(
          "rich-editor-content overflow-y-auto px-5 py-4 font-serif text-sm leading-relaxed text-editor-ink outline-none",
          disabled && "cursor-not-allowed",
        )}
        style={{ minHeight }}
      />
    </div>
  );
}
