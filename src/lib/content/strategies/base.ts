import type { QuickActionPlan, QuickActionSession, TargetDescriptor } from "$lib/content/quick-action-session";

export interface StrategyCaptureResult {
  ok: boolean;
  target: TargetDescriptor;
  reason?: string;
}

export interface StrategyResolveResult {
  ok: boolean;
  target: HTMLElement | null;
  reason?: string;
  ambiguous?: boolean;
}

export interface StrategyApplyResult {
  ok: boolean;
  reason?: string;
}

export interface StrategyVerifyResult {
  ok: boolean;
  reason?: string;
}

export interface StrategyRollbackResult {
  ok: boolean;
  reason?: string;
}

export interface ICommitStrategy {
  readonly kind: TargetDescriptor["kind"];
  capture(plan: QuickActionPlan): StrategyCaptureResult;
  resolve(session: QuickActionSession): StrategyResolveResult;
  apply(session: QuickActionSession, finalText: string): StrategyApplyResult;
  verify(session: QuickActionSession, finalText: string): StrategyVerifyResult;
  rollback(session: QuickActionSession): StrategyRollbackResult;
}
