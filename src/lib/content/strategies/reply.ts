import type { QuickActionPlan, QuickActionSession } from "$lib/content/quick-action-session";
import type {
  ICommitStrategy,
  StrategyApplyResult,
  StrategyCaptureResult,
  StrategyResolveResult,
  StrategyRollbackResult,
  StrategyVerifyResult,
} from "$lib/content/strategies/base";

export class ReplyStrategy implements ICommitStrategy {
  readonly kind = "none" as const;

  capture(plan: QuickActionPlan): StrategyCaptureResult {
    return { ok: plan.mode === "reply_insert", target: plan.target };
  }

  resolve(session: QuickActionSession): StrategyResolveResult {
    return {
      ok: session.plan.mode === "reply_insert",
      target: session.plan.target.target,
      reason: session.plan.mode === "reply_insert" ? undefined : "wrong action mode",
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
