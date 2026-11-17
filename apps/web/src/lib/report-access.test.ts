import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ReportActions } from "../components/report/ReportActions";
import { ReportStatusBadge } from "../components/ui/ReportStatusBadge";
import {
  canAmendReport,
  canEditReportContent,
  canSaveOrSignReport,
} from "./report-access";

test("MANAGER_APPROVED reports are read-only", () => {
  assert.equal(canEditReportContent("MANAGER_APPROVED", true, false), false);
  assert.equal(canEditReportContent("MANAGER_APPROVED", true, true), false);
  assert.equal(canSaveOrSignReport("MANAGER_APPROVED"), false);
  assert.equal(canAmendReport("MANAGER_APPROVED"), false);
});

test("drafts and explicit amendments remain editable", () => {
  assert.equal(canEditReportContent("DRAFT", true, false), true);
  assert.equal(canEditReportContent("SIGNED", true, false), false);
  assert.equal(canEditReportContent("SIGNED", true, true), true);
  assert.equal(canEditReportContent("DRAFT", false, false), false);
  assert.equal(canSaveOrSignReport("DRAFT"), true);
});

test("ReportActions disables Save Draft and Sign Off for MANAGER_APPROVED", () => {
  const html = renderToStaticMarkup(
    createElement(ReportActions, {
      status: "MANAGER_APPROVED",
      studyStatus: "MANAGER_APPROVED",
    }),
  );
  const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const saveDraft = buttons.find((button) => button.includes("Save Draft"));
  const signOff = buttons.find((button) => button.includes("Sign Off"));

  assert.match(saveDraft ?? "", /disabled/);
  assert.match(signOff ?? "", /disabled/);
});

test("amendment is only available while the study is RADIOLOGIST_SIGNED", () => {
  assert.equal(canAmendReport("CORRECTION_REQUESTED"), false);
  assert.equal(canAmendReport("RADIOLOGIST_SIGNED"), false);

  const reviewHtml = renderToStaticMarkup(
    createElement(ReportActions, {
      status: "SIGNED",
      studyStatus: "MANAGER_REVIEW",
      onAmend: () => undefined,
    }),
  );
  assert.doesNotMatch(reviewHtml, /Amend/);

  const signedHtml = renderToStaticMarkup(
    createElement(ReportActions, {
      status: "SIGNED",
      studyStatus: "RADIOLOGIST_SIGNED",
      onAmend: () => undefined,
    }),
  );
  const buttons = signedHtml.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
  const amend = buttons.find((button) => button.includes("Amend"));

  assert.match(amend ?? "", /Amend/);
  assert.doesNotMatch(amend ?? "", /disabled/);
});

test("report badge renders the report status, not the study status", () => {
  const html = renderToStaticMarkup(
    createElement(ReportStatusBadge, { status: "MANAGER_APPROVED" }),
  );

  assert.match(html, /Approved/);
  assert.doesNotMatch(html, /Assigned/);
});
