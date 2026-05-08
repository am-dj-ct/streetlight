import Link from "next/link";

export function CrisisFooter() {
  return (
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
        <Link href="#crisis-resources" className="font-semibold underline">
          Find a human
        </Link>
      </div>
    </footer>
  );
}
