"use client";

import { useMemo, useState } from "react";
import type { ConversationEntryId } from "../lib/chat-types";
import type { RegionScope } from "../lib/geo";
import { getConversationContentEntry } from "../lib/conversation-content";
import {
  isReportArea,
} from "../lib/report-problem";
import { reportAreas, type ReportArea } from "../lib/report-areas";
import type { ChatMode } from "../lib/runtime-state";
import { buildMailtoHref } from "../lib/support";
import {
  getLanguageOption,
  isSupportedLanguageCode,
  languageOptions,
  type SupportedLanguageCode,
} from "../lib/languages";
import type { InternalAppPath } from "../lib/routes";
import type { UiCopy } from "../lib/ui-copy";

type ReportAreaOption = {
  value: ReportArea;
  copyKey: keyof UiCopy;
};

const problemValues = [
  "wrong-facts",
  "missed-point",
  "unsafe-advice",
  "too-vague",
  "too-harsh",
  "too-soft",
  "technical-problem",
  "other",
] as const;

type ProblemValue = (typeof problemValues)[number];

const reportTextMaxLength = 800;
const reportDetailsMaxLength = 1200;

type ProblemOption = {
  value: ProblemValue;
  copyKey: keyof UiCopy;
};

const reportAreaCopyKeys: Record<ReportArea, keyof UiCopy> = {
  "main-screen": "reportAreaMainScreen",
  conversation: "reportAreaConversation",
  "find-human": "reportAreaFindHuman",
  saving: "reportAreaSaving",
  "voice-or-mic": "reportAreaVoiceOrMic",
  privacy: "reportAreaPrivacy",
  about: "reportAreaAbout",
  other: "reportAreaOther",
};

const whereOptions: readonly ReportAreaOption[] = reportAreas.map((value) => ({
  value,
  copyKey: reportAreaCopyKeys[value],
}));

const problemCopyKeys: Record<ProblemValue, keyof UiCopy> = {
  "wrong-facts": "reportWrongFacts",
  "missed-point": "reportWrongMissedPoint",
  "unsafe-advice": "reportWrongUnsafe",
  "too-vague": "reportWrongVague",
  "too-harsh": "reportWrongTooHarsh",
  "too-soft": "reportWrongTooSoft",
  "technical-problem": "reportWrongTechnical",
  other: "reportWrongOther",
};

const problemOptions: readonly ProblemOption[] = problemValues.map((value) => ({
  value,
  copyKey: problemCopyKeys[value],
}));

type ReportProblemFormProps = {
  chatMode: ChatMode;
  commitSha: null | string;
  copy: UiCopy;
  deployEnv: string;
  entryId?: ConversationEntryId;
  initialArea?: ReportArea;
  languageCode: SupportedLanguageCode;
  regionScope: RegionScope;
  sourcePath?: InternalAppPath;
};

function getChatModeLabel(chatMode: ChatMode, copy: UiCopy) {
  return chatMode === "mock-local"
    ? copy.reportChatModeMockLocal
    : copy.reportChatModeLiveModel;
}

function getRegionScopeLabel(regionScope: RegionScope, copy: UiCopy) {
  return regionScope === "king"
    ? copy.reportRegionScopeKing
    : copy.reportRegionScopeFallback;
}

export function ReportProblemForm({
  chatMode,
  commitSha,
  copy,
  deployEnv,
  entryId,
  initialArea,
  languageCode,
  regionScope,
  sourcePath,
}: ReportProblemFormProps) {
  const [where, setWhere] = useState(
    isReportArea(initialArea) ? initialArea : "conversation",
  );
  const [conversationLanguage, setConversationLanguage] = useState(languageCode);
  const [goal, setGoal] = useState("");
  const [reply, setReply] = useState("");
  const [details, setDetails] = useState("");
  const [selectedProblems, setSelectedProblems] = useState<ProblemValue[]>([]);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const whereLabel = copy[reportAreaCopyKeys[where]];
  const conversationLanguageLabel = getLanguageOption(conversationLanguage).label;
  const entryLabel = entryId
    ? getConversationContentEntry(entryId, conversationLanguage).label
    : null;
  const chatModeLabel = getChatModeLabel(chatMode, copy);
  const regionScopeLabel = getRegionScopeLabel(regionScope, copy);
  const commitShaLabel = commitSha ?? copy.reportCommitFallback;
  const sourcePathLabel = sourcePath ?? copy.reportSourceFallback;

  const selectedProblemLabels = selectedProblems.map(
    (value) => problemCopyKeys[value],
  );
  const reportSubject = useMemo(() => {
    const parts = [copy.reportTemplateTitle, whereLabel];

    if (entryLabel) {
      parts.push(entryLabel);
    }

    parts.push(chatModeLabel);

    return parts.join(" - ");
  }, [chatModeLabel, copy.reportTemplateTitle, entryLabel, whereLabel]);

  const reportBody = useMemo(() => {
    const lines = [
      copy.reportTemplateTitle,
      "",
      `${copy.reportTemplateWhereLabel}: ${whereLabel}`,
      `${copy.reportTemplateChatModeLabel}: ${chatModeLabel}`,
      `${copy.reportTemplateDeployEnvLabel}: ${deployEnv}`,
      `${copy.reportTemplateCommitLabel}: ${commitShaLabel}`,
      `${copy.reportTemplateResourceScopeLabel}: ${regionScopeLabel}`,
      `${copy.reportTemplateSourceRouteLabel}: ${sourcePathLabel}`,
      `${copy.reportTemplateConversationLanguageLabel}: ${conversationLanguageLabel}`,
    ];

    if (entryLabel) {
      lines.push(`${copy.reportTemplateEntryButtonLabel}: ${entryLabel}`);
    }

    lines.push("");
    lines.push(copy.reportTemplateGoalHeading);
    lines.push(goal.trim() || "[add paraphrase here]");
    lines.push("");
    lines.push(copy.reportTemplateReplyHeading);
    lines.push(reply.trim() || "[add paraphrase here]");
    lines.push("");
    lines.push(copy.reportTemplateWrongHeading);
    lines.push(
      selectedProblemLabels.length > 0
        ? selectedProblemLabels.map((key) => copy[key]).join(", ")
        : "[pick one or more]",
    );

    if (details.trim()) {
      lines.push("");
      lines.push(copy.reportTemplateDetailsHeading);
      lines.push(details.trim());
    }

    lines.push("");
    lines.push(copy.reportTemplateReminder);

    return lines.join("\n");
  }, [
    chatModeLabel,
    commitShaLabel,
    copy,
    details,
    deployEnv,
    goal,
    regionScopeLabel,
    reply,
    selectedProblemLabels,
    sourcePathLabel,
    conversationLanguageLabel,
    entryLabel,
    whereLabel,
  ]);

  function toggleProblem(problem: ProblemValue) {
    setSelectedProblems((current) =>
      current.includes(problem)
        ? current.filter((value) => value !== problem)
        : [...current, problem],
    );
  }

  function handleOpenEmail() {
    window.location.href = buildMailtoHref({
      subject: reportSubject,
      body: reportBody,
    });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(reportBody);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[18px] border border-[#cfd7cf] bg-white px-4 py-4 shadow-[0_1px_0_rgba(29,42,34,0.08)]">
        <p className="text-[17px] leading-7 text-[#334139]">
          {copy.reportPageIntro}
        </p>
        <p className="pt-3 text-[14px] leading-6 text-[#5f6d64]">
          {copy.reportPageCurrentChatModeLabel} {chatModeLabel}
        </p>
        <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
          {copy.reportPageCurrentDeployLabel} {deployEnv}
        </p>
        <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
          {copy.reportPageCurrentCommitLabel} {commitShaLabel}
        </p>
        <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
          {copy.reportPageCurrentResourceScopeLabel} {regionScopeLabel}
        </p>
        <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
          {copy.reportPageCurrentSourceRouteLabel} {sourcePathLabel}
        </p>
        {entryLabel ? (
          <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
            {copy.reportPageCurrentEntryButtonLabel} {entryLabel}
          </p>
        ) : null}
        <p className="pt-3 text-[15px] leading-6 text-[#5f6d64]">
          {copy.reportPagePrivacyWarning}
        </p>
      </section>

      <section className="space-y-4 rounded-[18px] border border-[#cfd7cf] bg-white px-4 py-4 shadow-[0_1px_0_rgba(29,42,34,0.08)]">
        <label className="block space-y-2">
          <span className="text-[15px] font-semibold leading-6 text-[#1f2923]">
            {copy.reportPageWhereLabel}
          </span>
          <select
            value={where}
            onChange={(event) =>
              setWhere(
                isReportArea(event.target.value)
                  ? event.target.value
                  : "conversation",
              )
            }
            className="min-h-12 w-full rounded-[16px] border border-[#b7c7bd] bg-white px-3 text-[16px] leading-6 text-[#1f2923] outline-none"
          >
            {whereOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {copy[option.copyKey]}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-[15px] font-semibold leading-6 text-[#1f2923]">
            {copy.reportPageLanguageLabel}
          </span>
          <select
            value={conversationLanguage}
            onChange={(event) =>
              setConversationLanguage((currentLanguage) =>
                isSupportedLanguageCode(event.target.value)
                  ? event.target.value
                  : currentLanguage,
              )
            }
            className="min-h-12 w-full rounded-[16px] border border-[#b7c7bd] bg-white px-3 text-[16px] leading-6 text-[#1f2923] outline-none"
          >
            {languageOptions.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block space-y-2">
          <span className="text-[15px] font-semibold leading-6 text-[#1f2923]">
            {copy.reportPageGoalLabel}
          </span>
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            maxLength={reportTextMaxLength}
            rows={4}
            className="w-full rounded-[16px] border border-[#b7c7bd] bg-white px-3 py-3 text-[16px] leading-6 text-[#1f2923] outline-none"
          />
        </label>

        <label className="block space-y-2">
          <span className="text-[15px] font-semibold leading-6 text-[#1f2923]">
            {copy.reportPageReplyLabel}
          </span>
          <textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            maxLength={reportTextMaxLength}
            rows={4}
            className="w-full rounded-[16px] border border-[#b7c7bd] bg-white px-3 py-3 text-[16px] leading-6 text-[#1f2923] outline-none"
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-[15px] font-semibold leading-6 text-[#1f2923]">
            {copy.reportPageWrongLabel}
          </legend>
          <div className="grid gap-2">
            {problemOptions.map((option) => (
              <label
                key={option.value}
                className="flex items-start gap-3 rounded-[16px] border border-[#d7ddd8] bg-[#f7f8f4] px-3 py-3 text-[15px] leading-6 text-[#334139]"
              >
                <input
                  type="checkbox"
                  checked={selectedProblems.includes(option.value)}
                  onChange={() => toggleProblem(option.value)}
                  className="mt-1 h-4 w-4 shrink-0"
                />
                <span>{copy[option.copyKey]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="block space-y-2">
          <span className="text-[15px] font-semibold leading-6 text-[#1f2923]">
            {copy.reportPageOptionalLabel}
          </span>
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            maxLength={reportDetailsMaxLength}
            rows={3}
            className="w-full rounded-[16px] border border-[#b7c7bd] bg-white px-3 py-3 text-[16px] leading-6 text-[#1f2923] outline-none"
          />
        </label>
      </section>

      <section className="space-y-3 rounded-[18px] border border-[#cfd7cf] bg-white px-4 py-4 shadow-[0_1px_0_rgba(29,42,34,0.08)]">
        <p className="text-[15px] leading-6 text-[#5f6d64]">
          {copy.reportPageParaphraseReminder}
        </p>
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={handleOpenEmail}
            className="inline-flex min-h-12 items-center justify-center rounded-[18px] bg-[#1f6a43] px-4 text-[17px] font-semibold text-white"
          >
            {copy.reportPageOpenEmail}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex min-h-12 items-center justify-center rounded-[18px] border border-[#b7c7bd] bg-white px-4 text-[17px] font-semibold text-[#1f2923]"
          >
            {copy.reportPageCopy}
          </button>
        </div>
        {copyState === "copied" ? (
          <p role="status" className="text-[14px] leading-6 text-[#37634d]">{copy.reportPageCopied}</p>
        ) : null}
        {copyState === "failed" ? (
          <p role="status" className="text-[14px] leading-6 text-[#8b3a3a]">
            {copy.reportPageCopyFailed}
          </p>
        ) : null}
      </section>
    </div>
  );
}
