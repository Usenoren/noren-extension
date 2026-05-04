// Noren — Content script: text capture, injection, floating button, selection toolbar

import { createShadowMount, type ShadowMountResult } from "$lib/content/shadow-mount";
import SelectionToolbar from "$lib/content/SelectionToolbar.svelte";
import StreamingDock from "$lib/content/StreamingDock.svelte";
import {
  QuickActionSession,
  type QuickActionMode,
  type QuickActionPlan,
  type QuickActionSelectionSnapshot,
  type QuickActionType,
  type TargetDescriptor,
} from "$lib/content/quick-action-session";
// @ts-ignore
import toolbarCss from "$lib/content/selection-toolbar.css?inline";
import streamingDockCss from "$lib/content/streaming-dock.css?inline";

// ============================================================
// Message listener (existing functionality)
// ============================================================

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "get-selection") {
    const text = window.getSelection()?.toString() || "";
    sendResponse({ text });
    return;
  }

  if (message.type === "inject-text") {
    const text = message.text as string;
    const replaceOriginal = message.replaceOriginal as boolean | undefined;
    if (replaceOriginal && savedEditableSelection) {
      injectReplace(text, savedEditableSelection);
      savedEditableSelection = null;
    } else {
      injectText(text);
    }
    sendResponse({ success: true });
    return;
  }
});

// ============================================================
// Last-focused element tracking for inject
// ============================================================
// When the sidepanel/popup steals focus, document.activeElement
// becomes <body>. We track the last editable element the user
// focused so inject can target it reliably.

let lastFocusedEditable: HTMLElement | null = null;

// Saved editable selection: captured on mouseup so it survives the
// focus shift to the sidepanel. Used by inject-replace (Weave panel)
// and contenteditable rewrite (quick actions).
let savedEditableSelection: {
  el: HTMLElement;
  start: number;
  end: number;
  text: string;
} | null = null;
let pendingReplyPointerTarget: HTMLElement | null = null;
let pendingReplyCommitTimer: ReturnType<typeof setTimeout> | undefined;

function resolveEditableTargetFromNode(node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLTextAreaElement || current instanceof HTMLInputElement) {
      return current;
    }
    if (current instanceof HTMLElement && current.getAttribute("contenteditable") === "true") {
      return current;
    }
    current = current.parentNode;
  }
  return null;
}

function clearPendingReplyTargetBinding() {
  pendingReplyPointerTarget = null;
  clearTimeout(pendingReplyCommitTimer);
  pendingReplyCommitTimer = undefined;
}

function schedulePendingReplyCommit(target: HTMLElement, source: "pointer" | "focus") {
  if (!pendingReplyCommit) return;

  clearTimeout(pendingReplyCommitTimer);
  pendingReplyCommitTimer = setTimeout(() => {
    pendingReplyCommitTimer = undefined;
    if (!pendingReplyCommit || !target.isConnected) return;

    if (source === "pointer") {
      const pointerTarget = pendingReplyPointerTarget;
      if (!pointerTarget || !pointerTarget.isConnected) return;
      const activeTarget = getEditableTarget();
      if (activeTarget !== pointerTarget && document.activeElement !== pointerTarget) return;
      commitPendingReplyTarget(pointerTarget);
      return;
    }

    if (pendingReplyPointerTarget) return;
    const activeTarget = getEditableTarget();
    if (activeTarget !== target && document.activeElement !== target) return;
    commitPendingReplyTarget(target);
  }, source === "pointer" ? 60 : 140);
}

document.addEventListener("focusin", (e) => {
  const el = resolveEditableTargetFromNode(e.target as Node | null);
  if (el) {
    lastFocusedEditable = el;
    if (pendingReplyCommit && !pendingReplyPointerTarget) {
      schedulePendingReplyCommit(el, "focus");
    }
  }
}, true);

// Capture selection range while focus is still on the editable field
// (before sidepanel or toolbar steals it). Covers mouse drag, Cmd+A,
// Shift+arrow, and any other selection method.
function captureEditableSelection() {
  const el = document.activeElement as HTMLElement;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    if (start !== end) {
      savedEditableSelection = { el, start, end, text: el.value.slice(start, end) };
    }
  } else if (el?.getAttribute("contenteditable") === "true") {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (text) {
      savedEditableSelection = { el, start: 0, end: 0, text };
    }
  }
}

document.addEventListener("mouseup", captureEditableSelection, true);
document.addEventListener("keyup", (e) => {
  if (e.shiftKey || e.metaKey || e.ctrlKey) captureEditableSelection();
}, true);

function injectReplace(text: string, sel: { el: HTMLElement; start: number; end: number; text: string }) {
  const el = sel.el;
  if (!el || !el.isConnected) {
    // Element gone (page navigated, field removed). Fall back to regular inject.
    injectText(text);
    return;
  }

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.focus();
    // Verify saved positions still match (user may have edited the field)
    const currentSlice = el.value.slice(sel.start, sel.end);
    if (currentSlice === sel.text) {
      el.selectionStart = sel.start;
      el.selectionEnd = sel.end;
      el.value = el.value.slice(0, sel.start) + text + el.value.slice(sel.end);
      el.selectionStart = el.selectionEnd = sel.start + text.length;
    } else {
      // Positions stale, fall back to find-and-replace
      const idx = el.value.indexOf(sel.text);
      if (idx !== -1) {
        el.value = el.value.slice(0, idx) + text + el.value.slice(idx + sel.text.length);
        el.selectionStart = el.selectionEnd = idx + text.length;
      } else {
        // Can't find original text, insert at cursor
        const pos = el.selectionStart ?? el.value.length;
        el.value = el.value.slice(0, pos) + text + el.value.slice(pos);
        el.selectionStart = el.selectionEnd = pos + text.length;
      }
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (el.getAttribute("contenteditable") === "true") {
    el.focus();
    // For contenteditable: find the original text and select it, then replace
    const found = findAndSelectText(el, sel.text);
    if (found) {
      if (isFrameworkEditor(el)) {
        const dt = new DataTransfer();
        dt.setData("text/plain", text);
        el.dispatchEvent(new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }));
      } else {
        document.execCommand("insertText", false, text);
      }
    } else {
      // Fallback: just insert
      document.execCommand("insertText", false, text);
    }
  }
}

function findAndSelectText(root: HTMLElement, searchText: string): boolean {
  // Walk text nodes to find and select the original text
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let accumulated = "";
  const nodes: { node: Text; start: number }[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push({ node, start: accumulated.length });
    accumulated += node.textContent || "";
  }

  const idx = accumulated.indexOf(searchText);
  if (idx === -1) return false;

  const endIdx = idx + searchText.length;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const { node, start } of nodes) {
    const nodeEnd = start + (node.textContent?.length || 0);
    if (!startNode && idx >= start && idx < nodeEnd) {
      startNode = node;
      startOffset = idx - start;
    }
    if (endIdx > start && endIdx <= nodeEnd) {
      endNode = node;
      endOffset = endIdx - start;
      break;
    }
  }

  if (!startNode || !endNode) return false;

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function findAndSelectAnchoredText(
  root: HTMLElement,
  searchText: string,
  anchors: { left: string; right: string },
): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let accumulated = "";
  const nodes: { node: Text; start: number }[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    nodes.push({ node, start: accumulated.length });
    accumulated += node.textContent || "";
  }

  const exactMatches: { start: number; end: number }[] = [];
  let startIndex = 0;
  while (true) {
    const idx = accumulated.indexOf(searchText, startIndex);
    if (idx === -1) break;
    exactMatches.push({ start: idx, end: idx + searchText.length });
    startIndex = idx + 1;
  }

  let candidates = exactMatches;

  // For longer selections, exact whole-block matching in framework editors
  // becomes brittle because the editor may normalize whitespace or split the
  // DOM differently across nested nodes. Fall back to boundary matching using
  // start/end probes, but only if it produces a unique candidate.
  if (candidates.length === 0 && searchText.length > 280) {
    const startProbe = searchText.slice(0, Math.min(96, searchText.length)).trim();
    const endProbe = searchText.slice(Math.max(0, searchText.length - 96)).trim();
    if (startProbe && endProbe) {
      const startCandidates: number[] = [];
      const endCandidates: number[] = [];

      let probeIndex = 0;
      while (true) {
        const idx = accumulated.indexOf(startProbe, probeIndex);
        if (idx === -1) break;
        startCandidates.push(idx);
        probeIndex = idx + 1;
      }

      probeIndex = 0;
      while (true) {
        const idx = accumulated.indexOf(endProbe, probeIndex);
        if (idx === -1) break;
        endCandidates.push(idx);
        probeIndex = idx + 1;
      }

      const approximateLength = searchText.length;
      const fuzzyCandidates: { start: number; end: number; score: number }[] = [];

      for (const start of startCandidates) {
        for (const endStart of endCandidates) {
          const end = endStart + endProbe.length;
          if (end <= start + startProbe.length) continue;
          const lengthDelta = Math.abs((end - start) - approximateLength);
          if (lengthDelta > Math.max(120, Math.floor(approximateLength * 0.2))) continue;

          const leftSlice = accumulated.slice(Math.max(0, start - anchors.left.length), start);
          const rightSlice = accumulated.slice(end, end + anchors.right.length);
          const startWindow = accumulated.slice(start, Math.min(accumulated.length, start + Math.max(startProbe.length + 24, 120)));
          const endWindow = accumulated.slice(Math.max(0, end - Math.max(endProbe.length + 24, 120)), end);
          const score = (startWindow.includes(startProbe) ? 1 : 0)
            + (endWindow.includes(endProbe) ? 1 : 0)
            + (!anchors.left || leftSlice === anchors.left ? 1 : 0)
            + (!anchors.right || rightSlice === anchors.right ? 1 : 0)
            - (lengthDelta / Math.max(approximateLength, 1));

          if (score >= 1.5) {
            fuzzyCandidates.push({ start, end, score });
          }
        }
      }

      fuzzyCandidates.sort((a, b) => b.score - a.score);
      const bestFuzzy = fuzzyCandidates[0];
      if (bestFuzzy && !(fuzzyCandidates.length > 1 && Math.abs((fuzzyCandidates[1]?.score ?? 0) - bestFuzzy.score) < 0.01)) {
        candidates = [{ start: bestFuzzy.start, end: bestFuzzy.end }];
      }
    }
  }

  if (candidates.length === 0) return false;

  const scored = candidates.map(({ start, end }) => {
    const leftSlice = accumulated.slice(Math.max(0, start - anchors.left.length), start);
    const rightSlice = accumulated.slice(end, end + anchors.right.length);
    let score = 0;
    if (!anchors.left || leftSlice === anchors.left) score += 1;
    if (!anchors.right || rightSlice === anchors.right) score += 1;
    return { start, end, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) return false;
  if (best.score === 0) return false;
  if (scored.length > 1 && scored[1]?.score === best.score) return false;

  const idx = best.start;
  const endIdx = best.end;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;

  for (const { node, start } of nodes) {
    const nodeEnd = start + (node.textContent?.length || 0);
    if (!startNode && idx >= start && idx < nodeEnd) {
      startNode = node;
      startOffset = idx - start;
    }
    if (endIdx > start && endIdx <= nodeEnd) {
      endNode = node;
      endOffset = endIdx - start;
      break;
    }
  }

  if (!startNode || !endNode) return false;

  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

function injectText(text: string) {
  // Prefer the currently active element if it's editable,
  // otherwise fall back to the last tracked editable element
  let el: HTMLElement | null = document.activeElement as HTMLElement;

  const isEditable =
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement ||
    el?.getAttribute("contenteditable") === "true";

  if (!isEditable) {
    el = lastFocusedEditable;
  }

  if (!el || !el.isConnected) return;

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.focus();
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (el?.getAttribute("contenteditable") === "true") {
    el.focus();
    if (isFrameworkEditor(el)) {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      el.dispatchEvent(new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }));
    } else {
      document.execCommand("insertText", false, text);
    }
  }
}

// ============================================================
// URL-based format detection for voice profile context layer
// ============================================================

function detectFormatFromUrl(): string | null {
  const host = location.hostname;
  if (host === "twitter.com" || host === "x.com" || host.endsWith(".x.com")) return "tweet";
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) return "linkedin";
  if (host === "mail.google.com" || host.match(/^outlook\./)) return "email";
  if (host === "slack.com" || host === "app.slack.com") return "slack";
  if (host.endsWith("medium.com") || host.endsWith("ghost.io")) return "blog";
  if (host.endsWith("substack.com")) return "newsletter";
  if (host.endsWith("reddit.com")) return "reddit";
  return null;
}

// ============================================================
// Surrounding context extraction for expand action
// ============================================================

function getSurroundingContext(selection: Selection, maxChars = 200): string | null {
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const fullText = (container.nodeType === Node.TEXT_NODE
    ? container.parentElement?.textContent
    : (container as HTMLElement).textContent) || "";
  const selectedText = selection.toString().trim();
  const idx = fullText.indexOf(selectedText);
  if (idx === -1) return null;
  const before = fullText.slice(Math.max(0, idx - maxChars), idx).trim();
  const after = fullText.slice(idx + selectedText.length, idx + selectedText.length + maxChars).trim();
  if (!before && !after) return null;
  let ctx = "";
  if (before) ctx += `...${before} `;
  ctx += `[SELECTED] `;
  if (after) ctx += `${after}...`;
  return ctx;
}

function getSelectionAnchors(selection: Selection | null, selectedText: string, maxChars = 24): { left: string; right: string } {
  if (!selection || !selection.rangeCount) {
    return getAnchorContext(selectedText);
  }

  try {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const fullText = (container.nodeType === Node.TEXT_NODE
      ? container.parentElement?.textContent
      : (container as HTMLElement).textContent) || "";
    const idx = fullText.indexOf(selectedText);
    if (idx === -1) {
      return getAnchorContext(selectedText);
    }
    return {
      left: fullText.slice(Math.max(0, idx - maxChars), idx),
      right: fullText.slice(idx + selectedText.length, idx + selectedText.length + maxChars),
    };
  } catch {
    return getAnchorContext(selectedText);
  }
}

// ============================================================
// Selection Toolbar — appears on text selection
// ============================================================

let toolbarMount: ShadowMountResult | null = null;
let streamingDockMount: ShadowMountResult | null = null;
let processingAction = false;
let activeQuickActionSession: QuickActionSession | null = null;
let pendingReplyCommit: {
  sessionId: string;
  finalText: string;
} | null = null;
let lastToolbarStatus: {
  x: number;
  y: number;
  below: boolean;
  statusText: string;
  previewText: string;
  statusLabel: string;
} | null = null;
let toolbarStatusTimer: ReturnType<typeof setTimeout> | undefined;
let pendingQuickActionCapture: {
  text: string;
  detectedFormat: string | null;
  selection: QuickActionSelectionSnapshot;
  target: TargetDescriptor;
  ui: {
    x: number;
    y: number;
    below: boolean;
  };
} | null = null;

// Cache theme synchronously so toolbar renders with correct palette instantly
let cachedTheme = "kon";
chrome.storage.local.get("theme").then(({ theme }) => {
  if (theme) cachedTheme = theme;
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.theme) {
    cachedTheme = changes.theme.newValue || "kon";
    if (toolbarMount) {
      toolbarMount.host.setAttribute("data-theme", cachedTheme);
    }
  }
});

// --- Selection detection ---
// Primary: mouseup (immediate, 10ms delay for SPA finalization)
// Fallback: selectionchange (250ms debounce, catches keyboard selection
// and sites that block mouseup via stopImmediatePropagation)

let mouseupHandledSelection = false;
let selectionChangeTimer: ReturnType<typeof setTimeout> | undefined;

function handleSelectionCheck() {
  if (processingAction) return;

  const selection = window.getSelection();
  const text = selection?.toString().trim();

  if (!text || text.length < 3) {
    dismissToolbar();
    return;
  }

  // Don't show if selection is inside our own shadow DOM
  const anchor = selection?.anchorNode;
  if (anchor && isInsideNorenUI(anchor)) return;

  try {
    const range = selection!.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    // Zero-rect guard: canvas editors (Google Docs) return 0x0
    if (rect.width === 0 && rect.height === 0) return;

    // Clamp to visible portion of selection (handles Cmd+A on long pages
    // where rect extends thousands of pixels beyond viewport)
    const visibleTop = Math.max(8, rect.top);
    const visibleBottom = Math.min(window.innerHeight - 8, rect.bottom);

    // Position: above by default. Below if not enough space above or inside
    // an editable (avoids native formatting toolbar). But never below if
    // that would push the toolbar off the viewport bottom.
    const noRoomAbove = visibleTop < 50;
    const noRoomBelow = visibleBottom > window.innerHeight - 50;
    const below = noRoomAbove || (isInsideEditable(selection!.anchorNode) && !noRoomBelow);
    const x = rect.left + rect.width / 2;
    const y = below ? visibleBottom : visibleTop;
    pendingQuickActionCapture = {
      text,
      detectedFormat: detectFormatFromUrl(),
      selection: createQuickActionSelectionSnapshot(selection, text),
      target: describeQuickActionTarget(text, getSelectionAnchors(selection, text)),
      ui: { x, y, below },
    };
    showToolbar(x, y, text, below);
  } catch {
    // getRangeAt can throw if selection is in an inaccessible context
  }
}

// Primary: window capture mouseup
window.addEventListener("mouseup", (e) => {
  if (toolbarMount && e.composedPath().includes(toolbarMount.host)) return;
  if (processingAction) return;

  mouseupHandledSelection = true;
  setTimeout(() => handleSelectionCheck(), 10);
  // Auto-reset after selectionchange debounce window (250ms) so future
  // keyboard selections aren't blocked by a stale flag
  setTimeout(() => { mouseupHandledSelection = false; }, 300);
}, true);

window.addEventListener("mousedown", (e) => {
  mouseupHandledSelection = false;
  if (pendingReplyCommit) {
    const editable = resolveEditableTargetFromNode(e.target as Node | null);
    if (editable) {
      pendingReplyPointerTarget = editable;
      schedulePendingReplyCommit(editable, "pointer");
      return;
    }
  }
  if (!toolbarMount) return;
  if (processingAction) return;
  const path = e.composedPath();
  if (!path.includes(toolbarMount.host)) {
    dismissToolbar();
  }
}, true);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (pendingReplyCommit) {
      pendingReplyCommit = null;
      clearPendingReplyTargetBinding();
      activeQuickActionSession?.transition("cancelled", "Reply target capture cancelled");
    }
    dismissToolbar();
  }
}, true);

// Fallback: selectionchange (keyboard selection, blocked mouseup)
document.addEventListener("selectionchange", () => {
  if (processingAction) return;
  // Don't refresh/dismiss while the user is interacting with the toolbar
  // (e.g., typing intent in reply mode). Shadow DOM retargets focus from
  // the inner input to the toolbar host element.
  if (toolbarMount && document.activeElement === toolbarMount.host) return;
  clearTimeout(selectionChangeTimer);
  selectionChangeTimer = setTimeout(() => {
    if (processingAction) return;
    if (mouseupHandledSelection) return;
    if (toolbarMount && document.activeElement === toolbarMount.host) return;
    const text = window.getSelection()?.toString().trim();
    if (!text || text.length < 3) {
      // Selection cleared (click, Cmd+A then click away, etc.)
      if (toolbarMount) dismissToolbar();
      return;
    }
    handleSelectionCheck();
  }, 250);
});

function isInsideEditable(node: Node | null): boolean {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement) {
      if (current.isContentEditable || current.tagName === "TEXTAREA" || current.tagName === "INPUT") {
        return true;
      }
    }
    current = current.parentNode;
  }
  return false;
}

function isInsideNorenUI(node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (current instanceof HTMLElement && current.tagName.toLowerCase().startsWith("noren-")) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function showToolbar(x: number, y: number, selectedText: string, below = false) {
  destroyToolbarMount();

  // Clamp x to viewport
  const cx = Math.max(120, Math.min(x, window.innerWidth - 120));

  toolbarMount = createShadowMount(
    SelectionToolbar as any,
    {
      x: cx,
      y,
      loading: false,
      below,
      onAction: (action: string, intent?: string) => handleQuickAction(action, selectedText, intent),
    },
    toolbarCss,
    "noren-selection-toolbar",
  );
  toolbarMount.host.setAttribute("data-theme", cachedTheme);
  document.body.appendChild(toolbarMount.host);
}

function showToolbarStatus(x: number, y: number, below: boolean, statusText: string, previewText = "", statusLabel = "") {
  const nextStatus = {
    x: Math.max(180, Math.min(x, window.innerWidth - 180)),
    y,
    below,
    statusText,
    previewText,
    statusLabel,
  };

  if (
    lastToolbarStatus &&
    lastToolbarStatus.x === nextStatus.x &&
    lastToolbarStatus.y === nextStatus.y &&
    lastToolbarStatus.below === nextStatus.below &&
    lastToolbarStatus.statusText === nextStatus.statusText &&
    lastToolbarStatus.previewText === nextStatus.previewText &&
    lastToolbarStatus.statusLabel === nextStatus.statusLabel
  ) {
    return;
  }

  lastToolbarStatus = nextStatus;
  if (toolbarStatusTimer) return;

  toolbarStatusTimer = setTimeout(() => {
    toolbarStatusTimer = undefined;
    if (!lastToolbarStatus) return;

    const { x: cx, y: cy, below: isBelow, statusText: text, previewText: preview, statusLabel: label } = lastToolbarStatus;
    if (!toolbarMount) {
      toolbarMount = createShadowMount(
        SelectionToolbar as any,
        {
          x: cx,
          y: cy,
          below: isBelow,
          loading: false,
          statusText: text,
          previewText: preview,
          statusLabel: label,
          onAction: () => {},
        },
        toolbarCss,
        "noren-selection-toolbar",
      );
      toolbarMount.host.setAttribute("data-theme", cachedTheme);
      document.body.appendChild(toolbarMount.host);
      return;
    }

    toolbarMount.update({
      x: cx,
      y: cy,
      below: isBelow,
      loading: false,
      statusText: text,
      previewText: preview,
      statusLabel: label,
      onAction: () => {},
    });
    toolbarMount.host.setAttribute("data-theme", cachedTheme);
  }, 100);
}

function createQuickActionSelectionSnapshot(selection: Selection | null, text: string): QuickActionSelectionSnapshot {
  if (!selection || selection.rangeCount === 0) {
    return { text, surroundingContext: null, rect: null };
  }

  let rect: QuickActionSelectionSnapshot["rect"] = null;
  try {
    const r = selection.getRangeAt(0).getBoundingClientRect();
    rect = { left: r.left, top: r.top, width: r.width, height: r.height };
  } catch {
    rect = null;
  }

  return {
    text,
    surroundingContext: getSurroundingContext(selection),
    rect,
  };
}

function getAnchorContext(text: string): { left: string; right: string } {
  const normalized = text.trim();
  const left = normalized.slice(0, Math.min(24, normalized.length));
  const right = normalized.slice(Math.max(0, normalized.length - 24));
  return { left, right };
}

function describeQuickActionTarget(
  selectedText: string,
  anchors: { left: string; right: string },
): TargetDescriptor {
  const savedTarget = savedEditableSelection?.el?.isConnected && savedEditableSelection.text === selectedText
    ? savedEditableSelection
    : null;
  const target = (savedTarget?.el || getEditableTarget()) as HTMLElement | null;

  if (!target) {
    return { kind: "none", target: null, root: null, selectedText, anchors };
  }

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    const start = savedTarget && savedTarget.el === target ? savedTarget.start : (target.selectionStart ?? 0);
    const end = savedTarget && savedTarget.el === target ? savedTarget.end : (target.selectionEnd ?? start);
    return {
      kind: "textarea_input",
      target,
      root: target,
      selectedText,
      anchors,
      start,
      end,
      originalValue: target.value,
    };
  }

  if (target.getAttribute("contenteditable") === "true") {
    return {
      kind: isFrameworkEditor(target) ? "framework_editor" : "plain_contenteditable",
      target,
      root: target,
      selectedText,
      anchors,
    };
  }

  return { kind: "none", target: null, root: null, selectedText, anchors };
}

function getQuickActionMode(action: QuickActionType): QuickActionMode {
  return action === "reply" ? "reply_insert" : "replace";
}

function buildQuickActionPlan(action: QuickActionType, text: string, intent?: string): QuickActionPlan {
  const cachedCapture = pendingQuickActionCapture && pendingQuickActionCapture.text === text
    ? pendingQuickActionCapture
    : null;
  const selection = window.getSelection();
  const anchors = cachedCapture?.target.anchors || getSelectionAnchors(selection, text);
  return {
    sessionId: crypto.randomUUID(),
    action,
    mode: getQuickActionMode(action),
    intent,
    detectedFormat: cachedCapture?.detectedFormat || detectFormatFromUrl(),
    selection: cachedCapture?.selection || createQuickActionSelectionSnapshot(selection, text),
    target: cachedCapture?.target || describeQuickActionTarget(text, anchors),
    createdAt: Date.now(),
  };
}

function destroyToolbarMount() {
  if (toolbarMount) {
    toolbarMount.destroy();
    toolbarMount = null;
  }
  lastToolbarStatus = null;
  clearTimeout(toolbarStatusTimer);
  toolbarStatusTimer = undefined;
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeGeneratedText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function textIncludesGeneratedText(haystack: string, finalText: string): boolean {
  const normalizedHaystack = normalizeGeneratedText(haystack);
  const normalizedFinal = normalizeGeneratedText(finalText);
  if (!normalizedHaystack || !normalizedFinal) return false;
  if (haystack.includes(finalText) || normalizedHaystack.includes(normalizedFinal)) return true;

  const startProbe = normalizeGeneratedText(finalText.slice(0, Math.min(96, finalText.length)));
  const endProbe = normalizeGeneratedText(finalText.slice(Math.max(0, finalText.length - 96)));
  if (!startProbe || !endProbe) return false;
  return normalizedHaystack.includes(startProbe) && normalizedHaystack.includes(endProbe);
}

function getFrameworkEditorRoot(el: HTMLElement): HTMLElement {
  return (
    el.closest("[data-testid^='tweetTextarea_']") ||
    el.closest(".DraftEditor-root") ||
    el.closest("[data-lexical-editor]") ||
    el.closest(".ql-editor") ||
    el.closest("shreddit-composer") ||
    el.closest("faceplate-textarea") ||
    el
  ) as HTMLElement;
}

function isElementVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function getFrameworkCommitCandidates(target: HTMLElement): HTMLElement[] {
  const candidates = new Set<HTMLElement>([target, getFrameworkEditorRoot(target)]);
  document
    .querySelectorAll<HTMLElement>(
      "[contenteditable='true'], [role='textbox'], [data-testid^='tweetTextarea_'], .DraftEditor-root, [data-lexical-editor], .ql-editor",
    )
    .forEach((el) => {
      if (!el.isConnected || !isElementVisible(el)) return;
      if (!isFrameworkEditor(el) && el.getAttribute("contenteditable") !== "true") return;
      candidates.add(el);
      candidates.add(getFrameworkEditorRoot(el));
    });
  return [...candidates].filter((el) => el.isConnected && isElementVisible(el));
}

async function verifyEditableCommit(
  target: HTMLElement,
  beforeText: string,
  originalText: string,
  finalText: string,
): Promise<boolean> {
  await waitForNextFrame();
  await waitForNextFrame();
  await wait(80);

  if (!target.isConnected) return false;
  if (!finalText.trim()) return false;

  const candidates = getFrameworkCommitCandidates(target);
  return candidates.some((candidate) => {
    if (!candidate.isConnected) return false;
    const afterText = candidate.textContent || "";
    if (afterText === beforeText && !textIncludesGeneratedText(afterText, finalText)) return false;
    if (!textIncludesGeneratedText(afterText, finalText)) return false;
    if (originalText && textIncludesGeneratedText(afterText, originalText) && !textIncludesGeneratedText(afterText, finalText)) {
      return false;
    }
    return true;
  });
}

function strictReplaceTextareaInput(
  el: HTMLTextAreaElement | HTMLInputElement,
  start: number,
  end: number,
  originalValue: string,
  selectedText: string,
  replacement: string,
): boolean {
  if (!el.isConnected) return false;
  if (el.value !== originalValue) return false;
  if (el.value.slice(start, end) !== selectedText) return false;

  el.focus();
  el.selectionStart = start;
  el.selectionEnd = end;
  el.value = el.value.slice(0, start) + replacement + el.value.slice(end);
  el.selectionStart = el.selectionEnd = start + replacement.length;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

function getReplyCommitAnchor(): { x: number; y: number; below: boolean } {
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    try {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      const below = rect.top < 50 || isInsideEditable(selection.anchorNode);
      return { x: rect.left + rect.width / 2, y: below ? rect.bottom : rect.top, below };
    } catch {
      // Ignore and fall through.
    }
  }
  return { x: window.innerWidth / 2, y: 100, below: false };
}

function commitPendingReplyTarget(target: HTMLElement) {
  if (!pendingReplyCommit) return;

  const finalText = pendingReplyCommit.finalText;
  let applied = false;

  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    const pos = target.selectionStart ?? target.value.length;
    target.focus();
    target.selectionStart = target.selectionEnd = pos;
    target.value = target.value.slice(0, pos) + finalText + target.value.slice(pos);
    target.selectionStart = target.selectionEnd = pos + finalText.length;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    applied = true;
  } else if (target.getAttribute("contenteditable") === "true" && isFrameworkEditor(target)) {
    target.focus();
    const dt = new DataTransfer();
    dt.setData("text/plain", finalText);
    target.dispatchEvent(new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    }));
    applied = true;
  } else {
    safeCopy(finalText, "Copied reply. Click target unsupported.");
  }

  pendingReplyCommit = null;
  clearPendingReplyTargetBinding();
  dismissToolbar();

  if (applied) {
    dismissStreamingDock();
    activeQuickActionSession?.transition("committed", "Reply target captured and reply inserted");
  } else {
    activeQuickActionSession?.transition("failed_manual", "Reply target unsupported; copied instead");
  }
}

function dismissToolbar() {
  destroyToolbarMount();
  processingAction = false;
  clearTimeout(selectionChangeTimer);
  if (!pendingReplyCommit) {
    clearPendingReplyTargetBinding();
    pendingQuickActionCapture = null;
  }
}

function showStreamingDock(text: string, label: string) {
  const props = {
    text,
    label,
    status: "Weaving...",
    done: false,
    hint: "",
    copyLabel: "Copy",
    copiedLabel: "Copied",
    onCopy: undefined,
    onClose: undefined,
  };
  if (!streamingDockMount) {
    streamingDockMount = createShadowMount(
      StreamingDock as any,
      props,
      streamingDockCss,
      "noren-streaming-dock",
    );
    streamingDockMount.host.setAttribute("data-theme", cachedTheme);
    document.body.appendChild(streamingDockMount.host);
    return;
  }
  streamingDockMount.update(props);
}

function showStreamingDockDone(
  text: string,
  label: string,
  onCopy: () => void,
  onClose: () => void,
  hint = "",
  copyLabel = "Copy",
  copiedLabel = "Copied",
) {
  if (!streamingDockMount) {
    streamingDockMount = createShadowMount(
      StreamingDock as any,
      { text, label, done: true, hint, copyLabel, copiedLabel, onCopy, onClose },
      streamingDockCss,
      "noren-streaming-dock",
    );
    streamingDockMount.host.setAttribute("data-theme", cachedTheme);
    document.body.appendChild(streamingDockMount.host);
    return;
  }
  streamingDockMount.update({ text, label, done: true, hint, copyLabel, copiedLabel, onCopy, onClose });
}

function showReplyTargetDock(finalText: string) {
  showStreamingDockDone(
    finalText,
    "Reply Ready",
    () => {
      safeCopy(finalText, "Copied to clipboard");
      pendingReplyCommit = null;
      clearPendingReplyTargetBinding();
      dismissStreamingDock();
      activeQuickActionSession?.transition("cancelled", "Reply target capture cancelled after copy");
    },
    () => {
      pendingReplyCommit = null;
      clearPendingReplyTargetBinding();
      dismissStreamingDock();
      activeQuickActionSession?.transition("cancelled", "Reply target capture cancelled");
    },
    "Copied. Click any text box to insert this reply.",
    "Copy again",
    "Copied",
  );
}

function dismissStreamingDock() {
  if (streamingDockMount) {
    streamingDockMount.destroy();
    streamingDockMount = null;
  }
}

async function handleQuickAction(action: string, text: string, intent?: string) {
  const quickAction = action as QuickActionType;
  const plan = buildQuickActionPlan(quickAction, text, intent);
  activeQuickActionSession = new QuickActionSession(plan);
  activeQuickActionSession.transition("plan_validated", "Quick action plan created", {
    detectedFormat: plan.detectedFormat,
    targetKind: plan.target.kind,
  });

  processingAction = true;

  const targetEl = plan.target.target;
  const streamIntoField = !!targetEl;

  // Generation progress belongs to the streaming dock. The selection toolbar
  // returns only for states that need an anchored instruction, such as
  // choosing a reply insertion target.
  destroyToolbarMount();

  // Gather context signals before deletion (selection still intact)
  const detectedFormat = plan.detectedFormat;
  const surroundingContext = plan.selection.surroundingContext;

  // Stream via port connection to background
  const port = chrome.runtime.connect({ name: "quick-action-stream" });
  let streamedText = "";
  let finalContent = "";
  let streamTerminated = false;

  const isTextarea = streamIntoField && targetEl &&
    (targetEl instanceof HTMLTextAreaElement || targetEl instanceof HTMLInputElement);
  const isContentEditable = streamIntoField && targetEl &&
    !isTextarea && targetEl.getAttribute("contenteditable") === "true";
  const isFramework = isContentEditable && isFrameworkEditor(targetEl!);

  activeQuickActionSession?.transition("executing", "Quick action generation started", {
    mode: plan.mode,
  });

  const dockLabel = action === "reply" ? "Reply" : action === "rewrite" ? "Rewrite" : "Fix";
  showStreamingDock("", dockLabel);

  port.onMessage.addListener((event) => {
    if (event.type === "delta") {
      streamedText += event.text;
      activeQuickActionSession?.appendPreview(event.text);
      showStreamingDock(activeQuickActionSession?.previewBuffer || streamedText, dockLabel);
    } else if (event.type === "done") {
      streamTerminated = true;
      finalContent = event.content || streamedText;
      activeQuickActionSession?.setFinalText(finalContent);
      activeQuickActionSession?.transition("commit_pending", "Quick action generation complete", {
        outputChars: finalContent.length,
      });
      port.disconnect();
      dismissToolbar();
      void (async () => {
        let commitApplied = false;
        let usedManualFallback = false;
        try {

        if (isContentEditable && targetEl) {
          const beforeText = targetEl.textContent || "";
          if (isFramework) {
            targetEl.focus();
            if (plan.mode === "reply_insert") {
              const dt = new DataTransfer();
              dt.setData("text/plain", finalContent);
              targetEl.dispatchEvent(new ClipboardEvent("paste", {
                clipboardData: dt,
                bubbles: true,
                cancelable: true,
              }));
              commitApplied = await verifyEditableCommit(targetEl, beforeText, "", finalContent);
              if (!commitApplied) {
                safeCopy(finalContent, "Copied reply. Couldn't verify insertion here.");
                usedManualFallback = true;
              }
            } else if (findAndSelectAnchoredText(targetEl, text, plan.target.anchors)) {
              const dt = new DataTransfer();
              dt.setData("text/plain", finalContent);
              targetEl.dispatchEvent(new ClipboardEvent("paste", {
                clipboardData: dt,
                bubbles: true,
                cancelable: true,
              }));
              commitApplied = await verifyEditableCommit(targetEl, beforeText, text, finalContent);
              if (!commitApplied) {
                safeCopy(finalContent, "Copied rewrite. Couldn't verify replacement here.");
                usedManualFallback = true;
              }
            } else {
              safeCopy(finalContent, "Copied rewrite. Couldn't safely replace here.");
              usedManualFallback = true;
            }
          } else {
            targetEl.focus();
            if (plan.mode === "reply_insert") {
              pendingReplyCommit = {
                sessionId: plan.sessionId,
                finalText: finalContent,
              };
              clearPendingReplyTargetBinding();
              safeCopy(finalContent, "");
              showReplyTargetDock(finalContent);
              activeQuickActionSession?.transition("executing", "Awaiting explicit reply target");
              return;
            } else if (findAndSelectAnchoredText(targetEl, text, plan.target.anchors)) {
              document.execCommand("insertText", false, finalContent);
              commitApplied = await verifyEditableCommit(targetEl, beforeText, text, finalContent);
              if (!commitApplied) {
                safeCopy(finalContent, "Copied rewrite. Couldn't verify replacement here.");
                usedManualFallback = true;
              }
            } else {
              safeCopy(finalContent, "Copied rewrite. Couldn't safely replace here.");
              usedManualFallback = true;
            }
          }
        } else if (isTextarea) {
          if (plan.target.kind === "textarea_input") {
            if (plan.mode === "reply_insert") {
              const el = plan.target.target;
              if (el.isConnected && el.value === plan.target.originalValue) {
                const insertAt = plan.target.end;
                el.focus();
                el.selectionStart = el.selectionEnd = insertAt;
                el.value = el.value.slice(0, insertAt) + finalContent + el.value.slice(insertAt);
                el.selectionStart = el.selectionEnd = insertAt + finalContent.length;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
                commitApplied = el.value.slice(insertAt, insertAt + finalContent.length) === finalContent;
              } else {
                safeCopy(finalContent, "Copied reply. Target changed while waiting.");
                usedManualFallback = true;
              }
            } else if (strictReplaceTextareaInput(
              plan.target.target,
              plan.target.start,
              plan.target.end,
              plan.target.originalValue,
              plan.target.selectedText,
              finalContent,
            )) {
              commitApplied = true;
            } else {
              safeCopy(finalContent, "Copied rewrite. Draft changed while waiting.");
              usedManualFallback = true;
            }
          } else {
            safeCopy(finalContent, "Copied result. Original selection wasn't editable.");
            usedManualFallback = true;
          }
        } else {
          if (plan.mode === "reply_insert") {
            pendingReplyCommit = {
              sessionId: plan.sessionId,
              finalText: finalContent,
            };
            clearPendingReplyTargetBinding();
            safeCopy(finalContent, "");
            showReplyTargetDock(finalContent);
            activeQuickActionSession?.transition("executing", "Awaiting explicit reply target");
            return;
          } else {
            safeCopy(finalContent, "Copied result. Original selection wasn't editable.");
            usedManualFallback = true;
          }
        }
        if (commitApplied) {
          dismissStreamingDock();
          activeQuickActionSession?.transition("committed", "Quick action applied");
        } else if (usedManualFallback) {
          activeQuickActionSession?.transition("failed_manual", "Quick action copied instead of applying");
        }
        } catch (err) {
          console.error("[Noren] Quick action commit failed:", err);
          if (finalContent) {
            safeCopy(finalContent, "Copied result. Couldn't apply automatically.");
          }
          activeQuickActionSession?.transition("failed_recoverable", "Quick action commit threw", {
            message: err instanceof Error ? err.message : String(err),
          });
        }

        if (!commitApplied && finalContent) {
          showStreamingDockDone(
            finalContent,
            dockLabel,
            () => {
              safeCopy(finalContent, "Copied to clipboard");
              dismissStreamingDock();
            },
            () => dismissStreamingDock(),
          );
        }
      })();
    } else if (event.type === "error") {
      streamTerminated = true;
      port.disconnect();
      dismissToolbar();
      dismissStreamingDock();
      activeQuickActionSession?.transition("failed_recoverable", "Quick action generation failed", {
        message: event.message,
      });
      console.error("[Noren] Quick action error:", event.message);
      showErrorNotification(event.message);
    }
  });

  port.onDisconnect.addListener(() => {
    if (streamTerminated) return;
    streamTerminated = true;
    dismissToolbar();
    dismissStreamingDock();
    activeQuickActionSession?.transition("failed_recoverable", "Quick action stream disconnected before completion", {
      hadPartialOutput: !!streamedText,
    });
    showErrorNotification(streamedText ? "Generation interrupted before completion" : "Connection lost");
  });

  port.postMessage({ action, text, detectedFormat, surroundingContext, intent });
}

function isFrameworkEditor(el: HTMLElement | null): boolean {
  if (!el) return false;
  // Draft.js (Twitter, Facebook)
  if (el.closest("[data-testid^='tweetTextarea_']")) return true;
  if (el.closest(".DraftEditor-root")) return true;
  // Lexical (Facebook)
  if (el.closest("[data-lexical-editor]")) return true;
  // LinkedIn's editor
  if (el.closest(".ql-editor")) return true;
  // Reddit's web component composer
  if (el.closest("shreddit-composer")) return true;
  if (el.closest("faceplate-textarea")) return true;
  return false;
}

function getEditableTarget(): HTMLElement | null {
  const el = document.activeElement as HTMLElement;
  if (
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement ||
    el?.getAttribute("contenteditable") === "true"
  ) {
    return el;
  }
  if (lastFocusedEditable && lastFocusedEditable.isConnected) {
    return lastFocusedEditable;
  }
  return null;
}

// Robust clipboard copy with legacy execCommand fallback for cases where
// navigator.clipboard.writeText rejects (e.g. document not focused, permission
// denied). Always surfaces success or failure to the user via a notification.
function safeCopy(text: string, successMessage = "Copied to clipboard") {
  const legacy = () => {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  };

  const notify = () => {
    if (successMessage) showCopiedNotificationWithText(successMessage);
  };

  navigator.clipboard.writeText(text)
    .then(notify)
    .catch(() => {
      if (legacy()) {
        notify();
      } else {
        console.error("[Noren] Failed to copy to clipboard:", text.slice(0, 100));
        if (successMessage) showErrorNotification("Couldn't copy to clipboard");
      }
    });
}

function appendToField(el: HTMLElement, text: string) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const pos = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, pos) + text + el.value.slice(pos);
    el.selectionStart = el.selectionEnd = pos + text.length;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (el.getAttribute("contenteditable") === "true") {
    el.focus();
    // Split by newlines and insert line breaks between paragraphs.
    // execCommand("insertText") swallows \n in contenteditable.
    const parts = text.split("\n");
    for (let i = 0; i < parts.length; i++) {
      if (parts[i]) {
        document.execCommand("insertText", false, parts[i]);
      }
      if (i < parts.length - 1) {
        document.execCommand("insertLineBreak");
      }
    }
  }
}

function showErrorNotification(error: string) {
  // Simplify common error messages
  let msg = "Something went wrong";
  const e = error.toLowerCase();
  if (e.includes("api key") || e.includes("401")) msg = "Invalid API key. Check Settings.";
  else if (e.includes("rate") || e.includes("429")) msg = "Rate limit reached. Try again shortly.";
  else if (e.includes("no voice profile") || e.includes("profile")) msg = "No voice profile found.";
  else if (e.includes("network") || e.includes("fetch")) msg = "Network error. Check your connection.";
  else if (error.trim()) msg = error.trim().slice(0, 160);

  const el = document.createElement("noren-notification");
  el.style.cssText = `
    all: initial;
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    padding: 8px 16px;
    background: #7A3340;
    color: #E8E3DD;
    font-family: -apple-system, system-ui, sans-serif;
    font-size: 13px;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    animation: noren-notif 3s ease-out forwards;
    pointer-events: none;
  `;
  el.textContent = msg;

  const style = document.createElement("style");
  style.textContent = `
    @keyframes noren-notif {
      0% { opacity: 0; transform: translateX(-50%) translateY(8px); }
      10% { opacity: 1; transform: translateX(-50%) translateY(0); }
      80% { opacity: 1; }
      100% { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(el);

  setTimeout(() => {
    el.remove();
    style.remove();
  }, 3100);
}

function showCopiedNotification() {
  showCopiedNotificationWithText("Copied to clipboard");
}

function showCopiedNotificationWithText(message: string) {
  const el = document.createElement("noren-notification");
  el.style.cssText = `
    all: initial;
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    padding: 8px 16px;
    background: #1E3148;
    color: #E8E3DD;
    font-family: -apple-system, system-ui, sans-serif;
    font-size: 13px;
    border-radius: 8px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.25);
    animation: noren-notif 2s ease-out forwards;
    pointer-events: none;
  `;
  el.textContent = message;

  const style = document.createElement("style");
  style.textContent = `
    @keyframes noren-notif {
      0% { opacity: 0; transform: translateX(-50%) translateY(8px); }
      15% { opacity: 1; transform: translateX(-50%) translateY(0); }
      75% { opacity: 1; }
      100% { opacity: 0; }
    }
  `;
  document.head.appendChild(style);
  document.body.appendChild(el);

  setTimeout(() => {
    el.remove();
    style.remove();
  }, 2100);
}
