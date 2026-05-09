import { NextRequest, NextResponse } from "next/server";
import {
  getPreferredLanguageCode,
  languageHeaderName,
} from "./lib/languages";
import { isHardPauseEnabled } from "./lib/env";
import { buildMailtoHref, supportEmail } from "./lib/support";

function isDocumentRequest(request: NextRequest) {
  return request.headers.get("accept")?.includes("text/html") === true;
}

function appendVaryHeader(headers: Headers, value: string) {
  const current = headers.get("Vary");

  if (!current) {
    headers.set("Vary", value);
    return;
  }

  const entries = new Set(
    current
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
  entries.add(value);
  headers.set("Vary", Array.from(entries).join(", "));
}

function setBrowserSecurityHeaders(headers: Headers) {
  headers.set("Permissions-Policy", "camera=(), geolocation=(), payment=(), usb=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
}

function renderHardPausePage(languageCode: string) {
  const problemReportHref = buildMailtoHref({
    subject: "Access Tool problem report",
  });

  return `<!doctype html>
<html lang="${languageCode}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Access Tool Paused</title>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        margin: 0;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f7f8f4;
        color: #1f2923;
      }
      main {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      article {
        width: 100%;
        max-width: 560px;
        border-radius: 24px;
        background: #ffffff;
        padding: 24px;
        box-shadow: 0 1px 0 rgba(29, 42, 34, 0.08);
      }
      h1 {
        margin: 0 0 16px;
        font-size: 28px;
        line-height: 1.2;
      }
      p {
        margin: 0 0 16px;
        font-size: 18px;
        line-height: 1.6;
      }
      .eyebrow {
        margin: 0 0 12px;
        font-size: 14px;
        line-height: 1.5;
        color: #55645b;
      }
      .help-box {
        margin: 24px 0;
        border: 1px solid #d8e1db;
        border-radius: 18px;
        background: #edf3ef;
        padding: 16px;
      }
      .help-box p {
        margin-bottom: 12px;
        font-size: 16px;
      }
      .links {
        display: flex;
        flex-wrap: wrap;
        gap: 10px 14px;
      }
      .links a,
      .links span {
        color: #1f2923;
        font-size: 16px;
        font-weight: 700;
      }
      .links a {
        text-decoration: underline;
      }
      .small {
        font-size: 15px;
        color: #55645b;
      }
      strong {
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        <p class="eyebrow">Access Tool is temporarily unavailable.</p>
        <h1>The tool is paused.</h1>
        <p>
          The tool is paused while the person who runs it checks on something.
        </p>
        <p>
          Try again later today.
        </p>
        <div class="help-box">
          <p><strong>If you need help right now:</strong></p>
          <div class="links">
            <span>Call or text 988</span>
            <span>Call 911</span>
            <span>24-Hr Crisis Line 866-427-4747</span>
            <span>Recovery Help 866-789-1511</span>
            <span>DV Hopeline 206-737-0242</span>
          </div>
        </div>
        <p class="small">
          Built and run by one person in Seattle.
        </p>
        <p class="small">
          Problem report: <a href="${problemReportHref}">${supportEmail}</a>
        </p>
      </article>
    </main>
  </body>
</html>`;
}

export function proxy(request: NextRequest) {
  const documentRequest = isDocumentRequest(request);
  const requestedLanguageCode = request.nextUrl.searchParams.get("lang");
  const resolvedLanguageCode = getPreferredLanguageCode({
    acceptLanguageHeader: request.headers.get("accept-language"),
    requestedLanguageCode,
  });

  if (isHardPauseEnabled()) {
    const response = new NextResponse(renderHardPausePage(resolvedLanguageCode), {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Language": resolvedLanguageCode,
      },
    });

    setBrowserSecurityHeaders(response.headers);
    appendVaryHeader(response.headers, "Accept-Language");

    return response;
  }

  if (!documentRequest) {
    return NextResponse.next();
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(languageHeaderName, resolvedLanguageCode);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set("Content-Language", resolvedLanguageCode);
  setBrowserSecurityHeaders(response.headers);
  appendVaryHeader(response.headers, "Accept-Language");

  return response;
}

export const config = {
  matcher: "/:path*",
};
