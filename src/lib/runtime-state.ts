import {
  getDeployCommitSha,
  getDeployEnvironment,
  getTtsDailyCharacterLimit,
  hasAzureSpeechConfig,
  hasHashedIpSalt,
  hasKvConfig,
  hasLiveModelConfig,
  hasTurnstileSecret,
  hasTurnstileSiteKey,
  isDevMockChatEnabled,
  isProductionTtsMockMisconfigured,
  isProductionMockMisconfigured,
  isTtsEnabled,
} from "./env";

export type ChatMode = "live-model" | "mock-local";

export type RuntimeState = {
  chatMode: ChatMode;
  commitSha: string;
  deployConfigOk: boolean;
  deployEnv: string;
  ok: true;
  service: "access-tool";
};

export function getChatMode(): ChatMode {
  return isDevMockChatEnabled() ? "mock-local" : "live-model";
}

export function getRuntimeState(): RuntimeState {
  const deployEnv = getDeployEnvironment();
  const hasAbuseControlsConfig =
    hasTurnstileSecret() &&
    hasTurnstileSiteKey() &&
    hasKvConfig() &&
    hasHashedIpSalt();

  return {
    chatMode: getChatMode(),
    commitSha: getDeployCommitSha() ?? "local-dev",
    deployConfigOk:
      !isProductionMockMisconfigured() &&
      !isProductionTtsMockMisconfigured() &&
      (deployEnv !== "production" ||
        (hasLiveModelConfig() &&
          hasAbuseControlsConfig &&
          isTtsEnabled() &&
          hasAzureSpeechConfig() &&
          getTtsDailyCharacterLimit() !== null)),
    deployEnv,
    ok: true,
    service: "access-tool",
  };
}
