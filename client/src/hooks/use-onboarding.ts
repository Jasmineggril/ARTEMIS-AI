/**
 * Persists onboarding/tutorial state in localStorage.
 * Key: platform_onboarding_status
 */

const STORAGE_KEY = "platform_onboarding_status";

export interface OnboardingStatus {
  completed: boolean;
  skipped: boolean;
  neverShow: boolean;
  currentStep: number;
  started: boolean;
}

const DEFAULT_STATUS: OnboardingStatus = {
  completed: false,
  skipped: false,
  neverShow: false,
  currentStep: 0,
  started: false,
};

export function getOnboardingStatus(): OnboardingStatus {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STATUS };
    return { ...DEFAULT_STATUS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STATUS };
  }
}

export function setOnboardingStatus(patch: Partial<OnboardingStatus>): void {
  try {
    const current = getOnboardingStatus();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // silent — localStorage may be unavailable
  }
}

export function resetOnboarding(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_STATUS));
  } catch {}
}

export function shouldShowWelcome(): boolean {
  const s = getOnboardingStatus();
  return !s.neverShow && !s.started && !s.completed;
}
