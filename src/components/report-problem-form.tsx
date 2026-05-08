"use client";

import { useMemo, useState } from "react";
import type { RegionScope } from "../lib/geo";
import { buildMailtoHref } from "../lib/support";
import { languageOptions, type SupportedLanguageCode } from "../lib/languages";
import type { UiCopy } from "../lib/ui-copy";

type ReportOption = {
  value: string;
  copyKey: keyof UiCopy;
};

const whereOptions: readonly ReportOption[] = [
  { value: "main-screen", copyKey: "reportAreaMainScreen" },
  { value: "conversation", copyKey: "reportAreaConversation" },
  { value: "find-human", copyKey: "reportAreaFindHuman" },
  { value: "saving", copyKey: "reportAreaSaving" },
  { value: "voice-or-mic", copyKey: "reportAreaVoiceOrMic" },
  { value: "privacy", copyKey: "reportAreaPrivacy" },
  { value: "about", copyKey: "reportAreaAbout" },
  { value: "other", copyKey: "reportAreaOther" },
];

const problemOptions: readonly ReportOption[] = [
  { value: "wrong-facts", copyKey: "reportWrongFacts" },
  { value: "missed-point", copyKey: "reportWrongMissedPoint" },
  { value: "unsafe-advice", copyKey: "reportWrongUnsafe" },
  { value: "too-vague", copyKey: "reportWrongVague" },
  { value: "too-harsh", copyKey: "reportWrongTooHarsh" },
  { value: "too-soft", copyKey: "reportWrongTooSoft" },
  { value: "technical-problem", copyKey: "reportWrongTechnical" },
  { value: "other", copyKey: "reportWrongOther" },
];

type ReportProblemFormProps = {
  chatMode: "live-model" | "mock-local";
  commitSha: null | string;
  copy: UiCopy;
  deployEnv: string;
  entryId?: string;
  initialArea?: string;
  languageCode: SupportedLanguageCode;
  regionScope: RegionScope;
  sourcePath?: string;
};

function isWhereOption(value: string | undefined): value is string {
  return whereOptions.some((option) => option.value === value);
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
    isWhereOption(initialArea) ? initialArea : "conversation",
  );
  const [conversationLanguage, setConversationLanguage] = useState(languageCode);
  const [goal, setGoal] = useState("");
  const [reply, setReply] = useState("");
  const [details, setDetails] = useState("");
  const [selectedProblems, setSelectedProblems] = useState<string[]>([]);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  const selectedProblemLabels = selectedProblems.map(
    (value) => problemOptions.find((option) => option.value === value)?.copyKey ?? "reportWrongOther",
  );
  const reportSubject = useMemo(() => {
    const parts = ["Access Tool problem report", where];

    if (entryId) {
      parts.push(entryId);
    }

    parts.push(chatMode);

    return parts.join(" - ");
  }, [chatMode, entryId, where]);

  const reportBody = useMemo(() => {
    const lines = [
      "Access Tool problem report",
      "",
      `Where this happened: ${where}`,
      `Chat mode: ${chatMode}`,
      `Deploy environment: ${deployEnv}`,
      `Commit SHA: ${commitSha ?? "local-dev"}`,
      `Resource scope: ${regionScope}`,
      `Source route: ${sourcePath ?? "not supplied"}`,
      `Conversation language: ${conversationLanguage}`,
    ];

    if (entryId) {
      lines.push(`Entry button: ${entryId}`);
    }

    lines.push("");
    lines.push("What the person was trying to do:");
    lines.push(goal.trim() || "[add paraphrase here]");
    lines.push("");
    lines.push("What the tool said (paraphrase only):");
    lines.push(reply.trim() || "[add paraphrase here]");
    lines.push("");
    lines.push("What felt wrong:");
    lines.push(
      selectedProblemLabels.length > 0
        ? selectedProblemLabels.map((key) => copy[key]).join(", ")
        : "[pick one or more]",
    );

    if (details.trim()) {
      lines.push("");
      lines.push("Anything else useful:");
      lines.push(details.trim());
    }

    lines.push("");
    lines.push("Reminder: do not paste the exact conversation or private details.");

    return lines.join("\n");
  }, [
    chatMode,
    commitSha,
    conversationLanguage,
    copy,
    details,
    deployEnv,
    entryId,
    goal,
    regionScope,
    reply,
    selectedProblemLabels,
    sourcePath,
    where,
  ]);

  const mailtoHref = useMemo(
    () =>
      buildMailtoHref({
        subject: reportSubject,
        body: reportBody,
      }),
    [reportBody, reportSubject],
  );

  function toggleProblem(problem: string) {
    setSelectedProblems((current) =>
      current.includes(problem)
        ? current.filter((value) => value !== problem)
        : [...current, problem],
    );
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
          Current chat mode: {chatMode}
        </p>
        <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
          Current deploy environment: {deployEnv}
        </p>
        <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
          Current commit: {commitSha ?? "local-dev"}
        </p>
        <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
          Current resource scope: {regionScope}
        </p>
        <p className="pt-2 text-[14px] leading-6 text-[#5f6d64]">
          Source route: {sourcePath ?? "not supplied"}
        </p>
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
            onChange={(event) => setWhere(event.target.value)}
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
              setConversationLanguage(event.target.value as SupportedLanguageCode)
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
          <a
            href={mailtoHref}
            className="inline-flex min-h-12 items-center justify-center rounded-[18px] bg-[#1f6a43] px-4 text-[17px] font-semibold text-white"
          >
            {copy.reportPageOpenEmail}
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex min-h-12 items-center justify-center rounded-[18px] border border-[#b7c7bd] bg-white px-4 text-[17px] font-semibold text-[#1f2923]"
          >
            {copy.reportPageCopy}
          </button>
        </div>
        {copyState === "copied" ? (
          <p className="text-[14px] leading-6 text-[#37634d]">{copy.reportPageCopied}</p>
        ) : null}
        {copyState === "failed" ? (
          <p className="text-[14px] leading-6 text-[#8b3a3a]">
            {copy.reportPageCopyFailed}
          </p>
        ) : null}
      </section>
    </div>
  );
}
