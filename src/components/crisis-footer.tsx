"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { getCrisisResources } from "../lib/crisis-resources";
import { PhoneAction } from "./phone-action";
import type { ConversationEntryId } from "../lib/chat-types";
import type { SupportedLanguageCode } from "../lib/languages";
import type { RegionScope } from "../lib/geo";
import type { ReportArea } from "../lib/report-areas";
import {
  buildAboutHref,
  buildFindHumanHref,
  buildPrivacyHref,
  buildReportProblemHref,
  type InternalAppPath,
} from "../lib/routes";
import { getUiCopy } from "../lib/ui-copy";

function ChevronIcon({
  className,
  direction = "down",
}: {
  className?: string;
  direction?: "up" | "down";
}) {
  return (
    <svg
      aria-hidden="true"
      className={`transition-transform ${direction === "up" ? "rotate-180" : ""} ${className ?? ""}`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <path
        d="m6 9 6 6 6-6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

export function CrisisFooter({
  area,
  collapsible = false,
  compact = false,
  entryId,
  languageCode = "en",
  regionScope = "king",
  showFindHumanInCompact = false,
  sourcePath,
  startCollapsed = false,
}: {
  area?: ReportArea;
  // Only the conversation view sets this: it lets the mobile footer default
  // to a single tap-reachable row once chatting has started, with a chevron
  // to expand back to the fuller compact view. Every other page keeps the
  // always-expanded compact view it already had (see docs on the 2026-05-09
  // "compact mobile footer" commits: those toggled compact on focus and
  // didn't stick, because the collapse has to key off "has chatted", not
  // keyboard/focus state).
  collapsible?: boolean;
  compact?: boolean;
  entryId?: ConversationEntryId;
  languageCode?: SupportedLanguageCode;
  regionScope?: RegionScope;
  showFindHumanInCompact?: boolean;
  sourcePath?: InternalAppPath;
  startCollapsed?: boolean;
}) {
  const copy = getUiCopy(languageCode);
  const collapsibleRegionId = useId();
  const [isExpanded, setIsExpanded] = useState(!startCollapsed);
  // Tracks the last startCollapsed we've reacted to, so the first-message
  // transition (false -> true) auto-collapses exactly once and never fights
  // a manual expand/collapse tap afterward. This is the "adjust state during
  // render when a prop changes" pattern rather than an effect, since an
  // effect that calls setState synchronously on every prop change is an
  // extra render pass for no benefit here.
  const [lastStartCollapsed, setLastStartCollapsed] = useState(startCollapsed);

  if (startCollapsed !== lastStartCollapsed) {
    setLastStartCollapsed(startCollapsed);

    if (startCollapsed) {
      setIsExpanded(false);
    }
  }

  const crisisResources = getCrisisResources(regionScope);
  const findHumanHref = buildFindHumanHref({
    entryId,
    languageCode,
  });
  const reportProblemHref = buildReportProblemHref({
    area,
    entryId,
    languageCode,
    sourcePath,
  });
  const fullFooterContent = (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <strong className="font-semibold">{copy.footerHeading}</strong>
        <PhoneAction
          actionType="call-and-text"
          copy={copy}
          label={copy.footerEmergency}
          phone="988"
          websiteUrl="https://988lifeline.org/"
          buttonClassName="font-semibold underline"
        />
        <PhoneAction
          copy={copy}
          label={copy.footerDangerNow}
          phone="911"
          websiteUrl="https://www.911.gov/"
          buttonClassName="font-semibold underline"
        />
        <span>
          {regionScope === "king"
            ? copy.footerLocalPlaceholder
            : copy.footerFallbackPlaceholder}
        </span>
        {crisisResources.map((resource) => (
          <PhoneAction
            key={resource.id}
            copy={copy}
            label={`${resource.label} ${resource.phone}`}
            phone={resource.phone}
            websiteUrl={resource.url}
            buttonClassName="font-semibold underline"
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-2">
        <Link href={findHumanHref} className="font-semibold underline">
          {copy.footerFindHuman}
        </Link>
        <Link href={buildPrivacyHref(languageCode)} className="font-semibold underline">
          {copy.footerPrivacy}
        </Link>
        <Link href={buildAboutHref(languageCode)} className="font-semibold underline">
          {copy.footerAbout}
        </Link>
        <Link href={reportProblemHref} className="font-semibold underline">
          {copy.footerReportProblem}
        </Link>
      </div>
    </>
  );

  const isCollapsedRow = collapsible && !isExpanded;

  return (
    <footer
      id="crisis-resources"
      className={`shrink-0 border-t border-[#cbd6cf] bg-[#edf3ef] px-4 text-[14px] leading-5 text-[#25342b] sm:px-6 lg:px-8 ${
        compact ? (isCollapsedRow ? "py-1.5 sm:py-3" : "py-2 sm:py-3") : "py-3"
      }`}
    >
      <div className="mx-auto max-w-md sm:max-w-2xl lg:max-w-4xl">
        {compact ? (
          <>
            <div className="sm:hidden">
              {collapsible ? (
                <div className={isExpanded ? "hidden" : "flex items-center gap-2"}>
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                    <strong className="font-semibold">{copy.footerHeading}</strong>
                    <PhoneAction
                      actionType="call-and-text"
                      copy={copy}
                      label="988"
                      phone="988"
                      websiteUrl="https://988lifeline.org/"
                      buttonClassName="font-semibold underline"
                    />
                    <span aria-hidden="true">&middot;</span>
                    <PhoneAction
                      copy={copy}
                      label="911"
                      phone="911"
                      websiteUrl="https://www.911.gov/"
                      buttonClassName="font-semibold underline"
                    />
                  </div>
                  <button
                    type="button"
                    aria-controls={collapsibleRegionId}
                    aria-expanded={false}
                    aria-label={copy.footerExpandLabel}
                    onClick={() => setIsExpanded(true)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#cbd6cf] bg-white text-[#25342b]"
                  >
                    <ChevronIcon className="h-4 w-4" direction="down" />
                  </button>
                </div>
              ) : null}

              <div
                id={collapsibleRegionId}
                className={isCollapsedRow ? "hidden" : ""}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <strong className="font-semibold">{copy.footerImmediateHelp}</strong>
                    <PhoneAction
                      copy={copy}
                      label="911"
                      phone="911"
                      websiteUrl="https://www.911.gov/"
                      buttonClassName="font-semibold underline"
                    />
                    {collapsible ? (
                      <button
                        type="button"
                        aria-controls={collapsibleRegionId}
                        aria-expanded={true}
                        aria-label={copy.footerCollapseLabel}
                        onClick={() => setIsExpanded(false)}
                        className="ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#cbd6cf] bg-white text-[#25342b]"
                      >
                        <ChevronIcon className="h-4 w-4" direction="up" />
                      </button>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <strong className="font-semibold">
                      {copy.footerMentalHealthCrisisHelp}
                    </strong>
                    <PhoneAction
                      actionType="call-and-text"
                      copy={copy}
                      label="988"
                      phone="988"
                      websiteUrl="https://988lifeline.org/"
                      buttonClassName="font-semibold underline"
                    />
                  </div>
                </div>

                {showFindHumanInCompact ? (
                  <div className="mt-2">
                    <Link href={findHumanHref} className="font-semibold underline">
                      {copy.footerFindHuman}
                    </Link>
                  </div>
                ) : null}

                <details className="mt-2">
                  <summary className="cursor-pointer rounded-[14px] border border-[#cbd6cf] bg-white px-3 py-2 text-[13px] font-medium text-[#25342b]">
                    {copy.footerMoreCrisisResources}
                  </summary>
                  <div className="pt-2">{fullFooterContent}</div>
                </details>
              </div>
            </div>
            <div className="hidden sm:block">{fullFooterContent}</div>
          </>
        ) : (
          fullFooterContent
        )}
      </div>
    </footer>
  );
}
