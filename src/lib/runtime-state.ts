import {
  getDeployCommitSha,
  getDeployEnvironment,
  hasLiveModelConfig,
  isDevMockChatEnabled,
  isProductionMockMisconfigured,
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
      (deployEnv !== "production" || hasLiveModelConfig()),
    deployEnv,
    ok: true,
    service: "access-tool",
  };
}
