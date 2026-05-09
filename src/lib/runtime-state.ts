import {
  getDeployCommitSha,
  getDeployEnvironment,
  getTtsDailyCharacterLimit,
  hasAzureSpeechConfig,
  hasLiveModelConfig,
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

  return {
    chatMode: getChatMode(),
    commitSha: getDeployCommitSha() ?? "local-dev",
    deployConfigOk:
      !isProductionMockMisconfigured() &&
      !isProductionTtsMockMisconfigured() &&
      (deployEnv !== "production" ||
        (hasLiveModelConfig() &&
          isTtsEnabled() &&
          hasAzureSpeechConfig() &&
          getTtsDailyCharacterLimit() !== null)),
    deployEnv,
    ok: true,
    service: "access-tool",
  };
}
