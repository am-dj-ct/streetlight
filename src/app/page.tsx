import { promptButtons } from "../lib/buttons";
import { languageOptions } from "../lib/languages";

const alternateActions = ["Type your own", "Talk instead"] as const;

export default function Home() {
  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-y-auto px-4 pt-4 pb-4">
        <nav
          aria-label="Choose language"
          className="-mx-1 flex flex-wrap gap-1 pb-3"
        >
          {languageOptions.map((language) => (
            <button
              key={language.code}
              type="button"
              className="min-h-10 shrink-0 rounded-lg border border-[#cfd7cf] bg-white px-3 text-[15px] font-medium text-[#314036]"
            >
              {language.label}
            </button>
          ))}
        </nav>

        <section className="flex-1 pb-4">
          <h1 className="pt-2 text-[28px] font-semibold leading-[1.16] text-[#171a18]">
            <span className="block">What do you need?</span>
            <span className="block">Pick one to start.</span>
          </h1>

          <div className="mt-5 flex flex-col gap-2.5">
            {promptButtons.map((button) => (
              <button
                key={button.id}
                type="button"
                className="min-h-16 w-full rounded-lg border border-[#b7c7bd] bg-white px-4 py-3 text-left text-[17px] font-semibold leading-6 text-[#1d2a22] shadow-[0_1px_0_rgba(29,42,34,0.08)]"
              >
                {button.label}
              </button>
            ))}

            <div className="my-1 h-px bg-[#dbe2dc]" aria-hidden="true" />

            {alternateActions.map((label) => (
              <button
                key={label}
                type="button"
                className="min-h-16 w-full rounded-lg border border-[#b7c7bd] bg-white px-4 py-3 text-left text-[17px] font-semibold leading-6 text-[#1d2a22] shadow-[0_1px_0_rgba(29,42,34,0.08)]"
              >
                {label}
              </button>
            ))}
          </div>
        </section>

      </div>

      <footer
        id="crisis-resources"
        className="shrink-0 border-t border-[#cbd6cf] bg-[#edf3ef] px-4 py-3 text-[14px] leading-5 text-[#25342b]"
      >
        <div className="mx-auto flex max-w-md flex-wrap items-center gap-x-3 gap-y-1">
          <strong className="font-semibold">Crisis help:</strong>
          <span>Call or text 988</span>
          <span>Call 911 for danger now</span>
          {/* TODO: Replace with maintained King County crisis numbers JSON. */}
          <span>King County crisis numbers coming soon</span>
          <button type="button" className="font-semibold underline">
            Find a human
          </button>
        </div>
      </footer>
    </main>
  );
}
