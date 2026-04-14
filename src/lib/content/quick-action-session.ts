export type QuickActionType = "rewrite" | "reply" | "fix";
export type QuickActionMode = "replace" | "reply_insert";

export type QuickActionState =
  | "idle"
  | "selection_captured"
  | "plan_validated"
  | "executing"
  | "commit_pending"
  | "committed"
  | "failed_recoverable"
  | "failed_manual"
  | "cancelled";

export type QuickActionTargetKind =
  | "textarea_input"
  | "plain_contenteditable"
  | "framework_editor"
  | "none";

export interface QuickActionSelectionSnapshot {
  text: string;
  surroundingContext: string | null;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
}

export interface QuickActionAnchorContext {
  left: string;
  right: string;
}

export interface TargetDescriptorBase {
  kind: QuickActionTargetKind;
  target: HTMLElement | null;
  root: HTMLElement | null;
  selectedText: string;
  anchors: QuickActionAnchorContext;
}

export interface TextareaInputTargetDescriptor extends TargetDescriptorBase {
  kind: "textarea_input";
  target: HTMLTextAreaElement | HTMLInputElement;
  start: number;
  end: number;
  originalValue: string;
}

export interface PlainContentEditableTargetDescriptor extends TargetDescriptorBase {
  kind: "plain_contenteditable";
  target: HTMLElement;
}

export interface FrameworkEditorTargetDescriptor extends TargetDescriptorBase {
  kind: "framework_editor";
  target: HTMLElement;
}

export interface EmptyTargetDescriptor extends TargetDescriptorBase {
  kind: "none";
  target: null;
}

export type TargetDescriptor =
  | TextareaInputTargetDescriptor
  | PlainContentEditableTargetDescriptor
  | FrameworkEditorTargetDescriptor
  | EmptyTargetDescriptor;

export interface QuickActionPlan {
  sessionId: string;
  action: QuickActionType;
  mode: QuickActionMode;
  intent?: string;
  detectedFormat: string | null;
  selection: QuickActionSelectionSnapshot;
  target: TargetDescriptor;
  createdAt: number;
}

export interface QuickActionSessionLogEntry {
  at: number;
  state: QuickActionState;
  message: string;
  detail?: Record<string, unknown>;
}

export class QuickActionSession {
  readonly id: string;
  readonly plan: QuickActionPlan;
  state: QuickActionState;
  previewBuffer = "";
  finalText = "";
  readonly log: QuickActionSessionLogEntry[] = [];

  constructor(plan: QuickActionPlan) {
    this.id = plan.sessionId;
    this.plan = plan;
    this.state = "selection_captured";
    this.record("selection_captured", "Session created", {
      action: plan.action,
      targetKind: plan.target.kind,
    });
  }

  transition(next: QuickActionState, message: string, detail?: Record<string, unknown>) {
    this.state = next;
    this.record(next, message, detail);
  }

  appendPreview(text: string) {
    this.previewBuffer += text;
  }

  setFinalText(text: string) {
    this.finalText = text;
  }

  private record(state: QuickActionState, message: string, detail?: Record<string, unknown>) {
    this.log.push({
      at: Date.now(),
      state,
      message,
      detail,
    });
  }
}
