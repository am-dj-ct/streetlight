import { isDevMockChatEnabled } from "../lib/env";

export function LocalDevBadge({ className = "" }: { className?: string }) {
  if (!isDevMockChatEnabled()) {
    return null;
  }

  return (
    <div className={className}>
      <div className="inline-flex items-center rounded-full border border-[#d0b478] bg-[#fff5da] px-3 py-1 text-[12px] font-medium leading-5 text-[#6b4f16]">
        Local mock chat mode: no live model calls
      </div>
    </div>
  );
}
