"use client";

import { useId, useState } from "react";
import { copyTextToClipboard } from "../lib/browser-copy";

type PhoneActionCopy = {
  phoneActionTitle: string;
  phoneActionDescription: string;
  phoneActionCopy: string;
  phoneActionCopied: string;
  phoneActionCopyFailed: string;
  phoneActionOpen: string;
  phoneActionClose: string;
  referralsWebsiteLabel: string;
};

type PhoneActionProps = {
  ariaLabel?: string;
  buttonClassName: string;
  copy: PhoneActionCopy;
  label: string;
  phone: string;
  websiteUrl?: string;
};

function formatTelephoneHref(phone: string) {
  return `tel:${phone.replace(/[^0-9]/g, "")}`;
}

export function PhoneAction({
  ariaLabel,
  buttonClassName,
  copy,
  label,
  phone,
  websiteUrl,
}: PhoneActionProps) {
  const dialogId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<null | "copied" | "failed">(null);

  async function handleCopy() {
    const copied = await copyTextToClipboard(phone);
    setCopyStatus(copied ? "copied" : "failed");
  }

  return (
    <>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-controls={dialogId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => {
          setCopyStatus(null);
          setIsOpen(true);
        }}
        className={buttonClassName}
      >
        {label}
      </button>

      {isOpen ? (
        <div className="fixed inset-0 z-20 flex items-end justify-center bg-[rgba(18,24,20,0.24)] sm:items-center sm:p-6">
          <div
            id={dialogId}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="w-full rounded-t-[24px] bg-white px-4 pb-6 pt-4 text-[#1f2923] shadow-[0_-12px_32px_rgba(18,24,20,0.18)] sm:max-w-xl sm:rounded-[24px] sm:px-6 sm:shadow-[0_16px_48px_rgba(18,24,20,0.18)]"
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-[#d4ddd6]" />
            <h2 id={titleId} className="text-[20px] font-semibold">
              {copy.phoneActionTitle}
            </h2>
            <p id={descriptionId} className="pt-2 text-[15px] leading-6 text-[#47564d]">
              {copy.phoneActionDescription}
            </p>
            <p className="pt-3 text-[24px] font-semibold leading-8">{phone}</p>

            {copyStatus ? (
              <p role="status" className="pt-3 text-[14px] leading-6 text-[#47564d]">
                {copyStatus === "copied"
                  ? copy.phoneActionCopied
                  : copy.phoneActionCopyFailed}
              </p>
            ) : null}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-[18px] border border-[#b7c7bd] bg-white px-4 text-[17px] font-semibold text-[#1f2923]"
              >
                {copy.phoneActionCopy}
              </button>
              {websiteUrl ? (
                <a
                  href={websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 flex-1 items-center justify-center rounded-[18px] border border-[#b7c7bd] bg-white px-4 text-[17px] font-semibold text-[#1f2923]"
                >
                  {copy.referralsWebsiteLabel}
                </a>
              ) : null}
              <a
                href={formatTelephoneHref(phone)}
                className="inline-flex min-h-12 flex-1 items-center justify-center rounded-[18px] bg-[#1f6a43] px-4 text-[17px] font-semibold text-white"
              >
                {copy.phoneActionOpen}
              </a>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-[18px] border border-[#b7c7bd] bg-white px-4 text-[17px] font-semibold text-[#1f2923]"
            >
              {copy.phoneActionClose}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
