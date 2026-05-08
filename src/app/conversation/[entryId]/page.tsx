import Link from "next/link";
import { notFound } from "next/navigation";
import { CrisisFooter } from "../../../components/crisis-footer";
import { getConversationSeed, conversationSeeds } from "../../../lib/conversation-shell";
import { languageOptions } from "../../../lib/languages";

type ConversationPageProps = {
  params: Promise<{
    entryId: string;
  }>;
};

export function generateStaticParams() {
  return conversationSeeds.map((entry) => ({
    entryId: entry.id,
  }));
}

export const dynamicParams = false;

export default async function ConversationPage({
  params,
}: ConversationPageProps) {
  const { entryId } = await params;
  const seed = getConversationSeed(entryId);

  if (!seed) {
    notFound();
  }

  const currentLanguage = languageOptions[0];

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-hidden px-4 pt-3">
        <header className="flex items-center justify-between pb-3">
          <Link
            href="/"
            aria-label="Go back"
            className="flex min-h-10 min-w-10 items-center justify-center rounded-full border border-[#cfd7cf] bg-white text-[20px] leading-none text-[#1d2a22]"
          >
            <span aria-hidden="true">{"<"}</span>
          </Link>

          <button
            type="button"
            className="min-h-10 rounded-full border border-[#cfd7cf] bg-white px-3 text-[15px] font-medium text-[#314036]"
          >
            {currentLanguage.label}
          </button>
        </header>

        <section className="min-h-0 flex-1 overflow-y-auto pb-4">
          <div className="flex flex-col gap-5">
            <article className="max-w-[88%] rounded-[18px] rounded-bl-[6px] bg-white px-4 py-3 text-[18px] leading-7 text-[#1f2923] shadow-[0_1px_0_rgba(29,42,34,0.08)]">
              {seed.assistantMessage}
            </article>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-10 rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
              >
                Play aloud
              </button>
              <Link
                href="#crisis-resources"
                className="flex min-h-10 items-center rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
              >
                Find a human for this
              </Link>
            </div>

            <div className="flex flex-wrap gap-2">
              {seed.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="min-h-12 rounded-[16px] border border-[#d4ddd6] bg-[#fdfefe] px-4 text-left text-[15px] leading-5 text-[#334139]"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="shrink-0 border-t border-[#d4ddd6] py-3">
          <div className="flex items-end gap-2">
            <label className="flex-1" htmlFor="conversation-input">
              <span className="sr-only">Type a message</span>
              <input
                id="conversation-input"
                type="text"
                autoFocus
                placeholder="Type here"
                className="min-h-14 w-full rounded-[18px] border border-[#b7c7bd] bg-white px-4 text-[17px] text-[#1f2923] outline-none placeholder:text-[#7c8a82]"
              />
            </label>
            <button
              type="button"
              aria-label="Use microphone"
              className="flex min-h-14 min-w-14 items-center justify-center rounded-[18px] border border-[#b7c7bd] bg-white text-[20px] text-[#1d2a22]"
            >
              Mic
            </button>
            <button
              type="button"
              aria-label="Send message"
              className="flex min-h-14 min-w-14 items-center justify-center rounded-[18px] bg-[#1f5f43] text-[20px] font-semibold text-white"
            >
              ^
            </button>
          </div>
        </section>
      </div>

      <CrisisFooter />
    </main>
  );
}
