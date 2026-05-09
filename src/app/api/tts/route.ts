import { NextResponse } from "next/server";
import {
  buildAzureSsml,
  getAzureTtsEndpoint,
  getAzureVoiceName,
} from "../../../lib/azure-tts";
import {
  getAzureSpeechKey,
  getAzureSpeechRegion,
  hasAzureSpeechConfig,
  isDevMockTtsEnabled,
  isProductionTtsMockMisconfigured,
  isTtsEnabled,
} from "../../../lib/env";
import { stripMarkdownForSpeech } from "../../../lib/speech-text";
import { reserveTtsCharactersForToday } from "../../../lib/tts-spend-control";
import {
  isTtsRequestBody,
  maxTtsRequestBodyBytes,
  type TtsRequestBody,
} from "../../../lib/tts-types";

function jsonNoStore(body: { error: string }, status: number, headers?: HeadersInit) {
  const response = NextResponse.json(body, {
    headers,
    status,
  });

  response.headers.set("Cache-Control", "no-store");

  return response;
}

async function readLimitedRequestBody(request: Request) {
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    totalBytes += value.byteLength;

    if (totalBytes > maxTtsRequestBodyBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }

    chunks.push(value);
  }

  const bodyBytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bodyBytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bodyBytes);
}

function makeMockWavBytes() {
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    0x66, 0x6d, 0x74, 0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
    0x40, 0x1f, 0x00, 0x00, 0x80, 0x3e, 0x00, 0x00, 0x02, 0x00, 0x10, 0x00,
    0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
  ]);
}

export async function POST(request: Request) {
  let body: TtsRequestBody;
  const contentLengthHeader = request.headers.get("content-length");

  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);

    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      return jsonNoStore({ error: "Invalid request shape." }, 400);
    }

    if (contentLength > maxTtsRequestBodyBytes) {
      return jsonNoStore({ error: "Request body too large." }, 413);
    }
  }

  try {
    const requestBodyText = await readLimitedRequestBody(request);

    if (requestBodyText === null) {
      return jsonNoStore({ error: "Request body too large." }, 413);
    }

    const parsedBody = JSON.parse(requestBodyText);

    if (!isTtsRequestBody(parsedBody)) {
      return jsonNoStore({ error: "Invalid request shape." }, 400);
    }

    body = parsedBody;
  } catch {
    return jsonNoStore({ error: "Invalid JSON body." }, 400);
  }

  const speechText = stripMarkdownForSpeech(body.text);

  if (!speechText) {
    return jsonNoStore({ error: "No text to read." }, 400);
  }

  if (isProductionTtsMockMisconfigured()) {
    return jsonNoStore({ error: "This deployment is misconfigured." }, 503);
  }

  if (isDevMockTtsEnabled()) {
    return new Response(makeMockWavBytes(), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "audio/wav",
      },
    });
  }

  if (!isTtsEnabled() || !hasAzureSpeechConfig()) {
    return jsonNoStore({ error: "Read-aloud is not available right now." }, 503);
  }

  const characterLimit = await reserveTtsCharactersForToday(speechText.length);

  if (!characterLimit.allowed) {
    return jsonNoStore(
      { error: "Read-aloud has reached today's limit. Please try again tomorrow." },
      503,
      {
        "Retry-After": String(characterLimit.resetInSeconds),
      },
    );
  }

  const requestStartedAt = Date.now();
  const language = body.language;
  const voiceName = getAzureVoiceName(language);
  const region = getAzureSpeechRegion();
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), 12000);

  try {
    const azureResponse = await fetch(getAzureTtsEndpoint(region), {
      body: buildAzureSsml({
        languageCode: language,
        text: speechText,
      }),
      headers: {
        "Content-Type": "application/ssml+xml",
        "Ocp-Apim-Subscription-Key": getAzureSpeechKey(),
        "User-Agent": "Access-Tool",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      },
      method: "POST",
      signal: abortController.signal,
    });

    if (!azureResponse.ok) {
      console.error({
        code: "azure_tts_failed",
        provider: "azure_ai_speech",
        status: azureResponse.status,
        language,
        voiceName,
        characterCount: speechText.length,
        responseTimeMs: Date.now() - requestStartedAt,
      });

      return jsonNoStore({ error: "Read-aloud is not available right now." }, 502);
    }

    const audioBytes = await azureResponse.arrayBuffer();

    if (audioBytes.byteLength === 0) {
      console.error({
        code: "azure_tts_empty_audio",
        provider: "azure_ai_speech",
        status: azureResponse.status,
        language,
        voiceName,
        characterCount: speechText.length,
        responseTimeMs: Date.now() - requestStartedAt,
      });

      return jsonNoStore({ error: "Read-aloud is not available right now." }, 502);
    }

    return new Response(audioBytes, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "audio/mpeg",
      },
    });
  } catch (error: unknown) {
    console.error({
      code: "azure_tts_request_failed",
      errorType: error instanceof Error ? error.name : "UnknownError",
      provider: "azure_ai_speech",
      language,
      voiceName,
      characterCount: speechText.length,
      responseTimeMs: Date.now() - requestStartedAt,
    });

    return jsonNoStore({ error: "Read-aloud is not available right now." }, 502);
  } finally {
    clearTimeout(timeout);
  }
}

export function GET() {
  return jsonNoStore({ error: "Method not allowed." }, 405, {
    Allow: "POST",
  });
}

export function OPTIONS() {
  return jsonNoStore({ error: "Method not allowed." }, 405, {
    Allow: "POST",
  });
}
