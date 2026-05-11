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
  isTurnstileEnabled,
  isTtsEnabled,
} from "./env";

export type ChatMode = "live-model" | "mock-local";

export type RuntimeState = {
  abuseControls: {
    hashedIpSaltConfigured: boolean;
    kvConfigured: boolean;
    turnstileEnabled: boolean;
    turnstileSecretConfigured: boolean;
    turnstileSiteKeyConfigured: boolean;
  };
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
  const abuseControls = {
    hashedIpSaltConfigured: hasHashedIpSalt(),
    kvConfigured: hasKvConfig(),
    turnstileEnabled: isTurnstileEnabled(),
    turnstileSecretConfigured: hasTurnstileSecret(),
    turnstileSiteKeyConfigured: hasTurnstileSiteKey(),
  };
  const hasTurnstileConfig =
    !abuseControls.turnstileEnabled ||
    (abuseControls.turnstileSecretConfigured &&
      abuseControls.turnstileSiteKeyConfigured);
  const hasAbuseControlsConfig =
    abuseControls.hashedIpSaltConfigured &&
    abuseControls.kvConfigured &&
    hasTurnstileConfig;

  return {
    abuseControls,
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
