"use client";

import { useEffect, useMemo } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import type { Study } from "@axis/types";
import {
  isReportRichContent,
  type ReportRichContent,
} from "@axis/types";
import { createReportEditorExtensions } from "./report-editor-extensions";

interface ReportDocumentCanvasProps {
  content: ReportRichContent;
  study: Study;
  editable: boolean;
  onChange?: (content: ReportRichContent) => void;
  onEditorReady?: (editor: Editor | null) => void;
}

export function ReportDocumentCanvas({
  content,
  study,
  editable,
  onChange,
  onEditorReady,
}: ReportDocumentCanvasProps) {
  const extensions = useMemo(
    () => createReportEditorExtensions(study),
    [study],
  );
  const editor = useEditor(
    {
      extensions,
      content,
      editable,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "axis-report-prosemirror",
          "aria-label": "Radiology report document",
        },
      },
      onUpdate: ({ editor: currentEditor }) => {
        const nextContent = currentEditor.getJSON();
        if (isReportRichContent(nextContent)) onChange?.(nextContent);
      },
    },
    [study.studyInstanceUid],
  );

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  return (
    <div className="axis-report-canvas">
      <EditorContent editor={editor} />
    </div>
  );
}
