import { isDevMockChatEnabled } from "../lib/env";
import type { SupportedLanguageCode } from "../lib/languages";
import { getUiCopy } from "../lib/ui-copy";

export function LocalDevBadge({
  className = "",
  languageCode = "en",
}: {
  className?: string;
  languageCode?: SupportedLanguageCode;
}) {
  if (!isDevMockChatEnabled()) {
    return null;
  }

  const copy = getUiCopy(languageCode);

  return (
    <div className={className}>
      <div className="inline-flex items-center rounded-full border border-[#d0b478] bg-[#fff5da] px-3 py-1 text-[12px] font-medium leading-5 text-[#6b4f16]">
        {copy.localDevBadgeLabel}
      </div>
    </div>
  );
}
