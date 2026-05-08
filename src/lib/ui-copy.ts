import type { SupportedLanguageCode } from "./languages";

export type UiCopy = {
  footerHeading: string;
  footerFindHuman: string;
  footerEmergency: string;
  footerDangerNow: string;
  footerLocalPlaceholder: string;
  footerFallbackPlaceholder: string;
  landingHeadingLineOne: string;
  landingHeadingLineTwo: string;
};

const englishCopy: UiCopy = {
  footerHeading: "Crisis help:",
  footerFindHuman: "Find a human",
  footerEmergency: "Call or text 988",
  footerDangerNow: "Call 911 for danger now",
  footerLocalPlaceholder: "King County crisis numbers coming soon",
  footerFallbackPlaceholder: "Local crisis numbers may be different where you are",
  landingHeadingLineOne: "What do you need?",
  landingHeadingLineTwo: "Pick one to start.",
};

export function getUiCopy(languageCode: SupportedLanguageCode): UiCopy {
  // TODO: Replace with professionally translated static JSON per language.
  void languageCode;
  return englishCopy;
}
