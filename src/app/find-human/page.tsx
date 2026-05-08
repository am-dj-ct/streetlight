import Link from "next/link";
import { CrisisFooter } from "../../components/crisis-footer";
import {
  getBackHrefForReferrals,
  getReferralsForCategory,
  getWeakCategoryLabel,
  isWeakCategory,
} from "../../lib/referrals";

type FindHumanPageProps = {
  searchParams: Promise<{
    category?: string;
    entryId?: string;
  }>;
};

export default async function FindHumanPage({
  searchParams,
}: FindHumanPageProps) {
  const { category: rawCategory, entryId } = await searchParams;
  const category =
    rawCategory && isWeakCategory(rawCategory) ? rawCategory : undefined;
  const referrals = getReferralsForCategory(category);
  const backHref = getBackHrefForReferrals(entryId);
  const categoryLabel = category ? getWeakCategoryLabel(category) : "";

  return (
    <main className="flex h-dvh flex-col overflow-hidden bg-[#f7f8f4] text-[#202124]">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col overflow-y-auto px-4 pt-3 pb-4">
        <header className="pb-4">
          <div className="flex items-center justify-between">
            <Link
              href={backHref}
              aria-label="Go back"
              className="flex min-h-10 min-w-10 items-center justify-center rounded-full border border-[#cfd7cf] bg-white text-[20px] leading-none text-[#1d2a22]"
            >
              <span aria-hidden="true">{"<"}</span>
            </Link>
            <span className="rounded-full border border-[#cfd7cf] bg-white px-3 py-2 text-[14px] font-medium text-[#314036]">
              King County, WA
            </span>
          </div>

          <h1 className="pt-4 text-[28px] font-semibold leading-[1.16] text-[#171a18]">
            <span className="block">Find a human</span>
            <span className="block">who can help with this</span>
          </h1>
          <p className="pt-3 text-[16px] leading-6 text-[#47564d]">
            These are real services, not model-generated suggestions.
            Resources are curated for King County. If you are somewhere else,
            start with 211 and 988.
          </p>
        </header>

        {category && category !== "none" ? (
          <section className="mb-4 rounded-[18px] border border-[#ead8b7] bg-[#fff9ef] px-4 py-3 text-[15px] leading-6 text-[#6a4c12]">
            This list is filtered for{" "}
            <span className="font-semibold">{categoryLabel}</span>.
          </section>
        ) : null}

        <section className="flex flex-1 flex-col gap-3 pb-4">
          {referrals.map((resource) => (
            <article
              key={resource.id}
              className="rounded-[18px] border border-[#cfd7cf] bg-white px-4 py-4 shadow-[0_1px_0_rgba(29,42,34,0.08)]"
            >
              <h2 className="text-[18px] font-semibold leading-6 text-[#1f2923]">
                {resource.name}
              </h2>
              <p className="pt-2 text-[15px] leading-6 text-[#47564d]">
                {resource.description}
              </p>

              <div className="pt-4 flex flex-wrap gap-2">
                {resource.phone ? (
                  <a
                    href={`tel:${resource.phone.replace(/[^0-9]/g, "")}`}
                    className="flex min-h-11 items-center rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
                  >
                    Call {resource.phone}
                  </a>
                ) : null}

                {resource.secondaryPhone ? (
                  <a
                    href={`tel:${resource.secondaryPhone.replace(/[^0-9]/g, "")}`}
                    className="flex min-h-11 items-center rounded-full border border-[#b7c7bd] bg-white px-4 text-[15px] font-medium text-[#1d2a22]"
                  >
                    Alt {resource.secondaryPhone}
                  </a>
                ) : null}

                <a
                  href={resource.website}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-11 items-center rounded-full bg-[#1f5f43] px-4 text-[15px] font-semibold text-white"
                >
                  Open website
                </a>
              </div>
            </article>
          ))}
        </section>
      </div>

      <CrisisFooter entryId={entryId} />
    </main>
  );
}
