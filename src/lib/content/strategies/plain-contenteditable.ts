import type { QuickActionPlan, QuickActionSession } from "$lib/content/quick-action-session";
import type {
  ICommitStrategy,
  StrategyApplyResult,
  StrategyCaptureResult,
  StrategyResolveResult,
  StrategyRollbackResult,
  StrategyVerifyResult,
} from "$lib/content/strategies/base";

export class PlainContentEditableStrategy implements ICommitStrategy {
  readonly kind = "plain_contenteditable" as const;

  capture(plan: QuickActionPlan): StrategyCaptureResult {
    return { ok: plan.target.kind === this.kind, target: plan.target };
  }

  resolve(session: QuickActionSession): StrategyResolveResult {
    return {
      ok: session.plan.target.kind === this.kind,
      target: session.plan.target.target,
      reason: session.plan.target.kind === this.kind ? undefined : "wrong target kind",
    };
  }

  apply(_session: QuickActionSession, _finalText: string): StrategyApplyResult {
    return { ok: false, reason: "not implemented" };
  }

  verify(_session: QuickActionSession, _finalText: string): StrategyVerifyResult {
    return { ok: false, reason: "not implemented" };
  }

  rollback(_session: QuickActionSession): StrategyRollbackResult {
    return { ok: false, reason: "not implemented" };
  }
}
