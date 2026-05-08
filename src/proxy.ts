import { NextResponse } from "next/server";

const hardPausePage = `<!doctype html>
<html lang="en">
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
      strong {
        font-weight: 700;
      }
    </style>
  </head>
  <body>
    <main>
      <article>
        <h1>The tool is paused.</h1>
        <p>
          The tool is paused while the person who runs it checks on something.
        </p>
        <p>
          <strong>If you need help right now:</strong> 988 for crisis, 211 for resources, 911 for emergencies.
        </p>
        <p>
          Built and run by one person in Seattle.
        </p>
      </article>
    </main>
  </body>
</html>`;

export function proxy() {
  if (process.env.HARD_PAUSE_ENABLED === "true") {
    return new NextResponse(hardPausePage, {
      status: 503,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/:path*",
};
