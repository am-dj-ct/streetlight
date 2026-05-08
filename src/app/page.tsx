import Link from "next/link";
import { CrisisFooter } from "../components/crisis-footer";
import { alternateActions, promptButtons } from "../lib/buttons";
import { languageOptions } from "../lib/languages";

export default function Home() {
  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-y-auto px-4 pt-4 pb-4">
        <nav
          aria-label="Choose language"
          className="flex flex-wrap items-center gap-x-1 gap-y-1 pb-4 text-[15px] leading-6 text-[#314036]"
        >
          {languageOptions.map((language, i) => (
            <span key={language.code} className="flex items-center gap-x-1">
              <button
                type="button"
                className="min-h-10 px-1 font-medium underline-offset-4 hover:underline"
              >
                {language.label}
              </button>
              {i < languageOptions.length - 1 && (
                <span aria-hidden="true" className="text-[#8a9b8f]">
                  ·
                </span>
              )}
            </span>
          ))}
        </nav>

        <section className="flex-1 pb-4">
          <h1 className="pt-2 text-[28px] font-semibold leading-[1.16] text-[#171a18]">
            <span className="block">What do you need?</span>
            <span className="block">Pick one to start.</span>
          </h1>

          <div className="mt-5 flex flex-col gap-2.5">
            {promptButtons.map((button) => (
              <Link
                key={button.id}
                href={`/conversation/${button.id}`}
                className="flex min-h-16 w-full items-center rounded-lg border border-[#b7c7bd] bg-white px-4 py-3 text-left text-[17px] font-semibold leading-6 text-[#1d2a22] shadow-[0_1px_0_rgba(29,42,34,0.08)]"
              >
                {button.label}
              </Link>
            ))}

            {alternateActions.map((action) => (
              <Link
                key={action.id}
                href={`/conversation/${action.id}`}
                className="flex min-h-16 w-full items-center rounded-lg border border-[#b7c7bd] bg-white px-4 py-3 text-left text-[17px] font-semibold leading-6 text-[#1d2a22] shadow-[0_1px_0_rgba(29,42,34,0.08)]"
              >
                {action.label}
              </Link>
            ))}
          </div>
        </section>

      </div>
      <CrisisFooter />
    </main>
  );
}
