import { NextRequest, NextResponse } from "next/server";
import {
  defaultLanguageCode,
  isSupportedLanguageCode,
  languageCookieName,
  languageHeaderName,
} from "./lib/languages";

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

function renderHardPausePage(languageCode: string) {
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
      .links a {
        color: #1f2923;
        font-size: 16px;
        font-weight: 700;
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
            <a href="tel:988">Call or text 988</a>
            <a href="tel:911">Call 911</a>
            <a href="tel:8664274747">24-Hr Crisis Line 866-427-4747</a>
            <a href="tel:8667891511">Recovery Help 866-789-1511</a>
            <a href="tel:2067370242">DV Hopeline 206-737-0242</a>
          </div>
        </div>
        <p class="small">
          Built and run by one person in Seattle.
        </p>
        <p class="small">
          Problem report: <a href="mailto:jesse.c.dunn@outlook.com?subject=Access%20Tool%20problem%20report">jesse.c.dunn@outlook.com</a>
        </p>
      </article>
    </main>
  </body>
</html>`;
}

export function proxy(request: NextRequest) {
  const requestedLanguageCode = request.nextUrl.searchParams.get("lang");
  const storedLanguageCode = request.cookies.get(languageCookieName)?.value;
  const resolvedLanguageCode = isSupportedLanguageCode(requestedLanguageCode)
    ? requestedLanguageCode
    : isSupportedLanguageCode(storedLanguageCode)
      ? storedLanguageCode
      : defaultLanguageCode;

  if (process.env.HARD_PAUSE_ENABLED === "true") {
    const response = new NextResponse(renderHardPausePage(resolvedLanguageCode), {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Language": resolvedLanguageCode,
      },
    });

    appendVaryHeader(response.headers, "Accept-Language");
    appendVaryHeader(response.headers, "Cookie");

    if (
      isSupportedLanguageCode(requestedLanguageCode) &&
      requestedLanguageCode !== storedLanguageCode
    ) {
      response.cookies.set(languageCookieName, requestedLanguageCode, {
        httpOnly: false,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
      });
    }

    return response;
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(languageHeaderName, resolvedLanguageCode);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (isDocumentRequest(request)) {
    response.headers.set("Content-Language", resolvedLanguageCode);
  }

  if (
    isSupportedLanguageCode(requestedLanguageCode) &&
    requestedLanguageCode !== storedLanguageCode
  ) {
    response.cookies.set(languageCookieName, requestedLanguageCode, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
  }

  return response;
}

export const config = {
  matcher: "/:path*",
};
