// Noren — Content script: text capture, injection, floating button, selection toolbar

import { createShadowMount, type ShadowMountResult } from "$lib/content/shadow-mount";
import SelectionToolbar from "$lib/content/SelectionToolbar.svelte";
// @ts-ignore
import toolbarCss from "$lib/content/selection-toolbar.css?inline";

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
    injectText(text);
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

document.addEventListener("focusin", (e) => {
  const el = e.target as HTMLElement;
  if (
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLInputElement ||
    el?.getAttribute("contenteditable") === "true"
  ) {
    lastFocusedEditable = el;
  }
}, true);

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

// ============================================================
// Selection Toolbar — appears on text selection
// ============================================================

let toolbarMount: ShadowMountResult | null = null;
let processingAction = false;

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

// Use capture phase so page scripts can't swallow the event with stopPropagation
document.addEventListener("mouseup", (e) => {
  // Ignore clicks on our own toolbar
  if (toolbarMount && e.composedPath().includes(toolbarMount.host)) return;
  // Don't interfere while a quick action is running
  if (processingAction) return;

  // Small delay for selection to finalize
  setTimeout(() => {
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

    const range = selection!.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Above by default. Flip below if:
    // 1. Not enough viewport space above (toolbar ~40px + 8px gap), or
    // 2. Inside an editable field (native formatting toolbars appear above)
    const below = rect.top < 50 || isInsideEditable(selection!.anchorNode);
    showToolbar(rect.left + rect.width / 2, below ? rect.bottom : rect.top, text, below);
  }, 10);
}, true);

document.addEventListener("mousedown", (e) => {
  if (!toolbarMount) return;
  if (processingAction) return;
  const path = e.composedPath();
  if (!path.includes(toolbarMount.host)) {
    dismissToolbar();
  }
}, true);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") dismissToolbar();
}, true);

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
  dismissToolbar();

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

function dismissToolbar() {
  if (toolbarMount) {
    toolbarMount.destroy();
    toolbarMount = null;
  }
  processingAction = false;
}

async function handleQuickAction(action: string, text: string, intent?: string) {
  processingAction = true;

  // Show loading state — recreate toolbar with loading=true
  const sel = window.getSelection();
  let tx = window.innerWidth / 2, ty = 100;
  let belowPos = false;
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0).getBoundingClientRect();
    tx = r.left + r.width / 2;
    belowPos = r.top < 50 || isInsideEditable(sel.anchorNode);
    ty = belowPos ? r.bottom : r.top;
  }

  const targetEl = getEditableTarget();
  const frameworkEditor = targetEl ? isFrameworkEditor(targetEl) : false;
  const streamIntoField = !!targetEl;

  // Destroy old toolbar, create loading one
  if (toolbarMount) {
    toolbarMount.destroy();
    toolbarMount = null;
  }

  toolbarMount = createShadowMount(
    SelectionToolbar as any,
    { x: Math.max(120, Math.min(tx, window.innerWidth - 120)), y: ty, loading: true, below: belowPos, onAction: () => {} },
    toolbarCss,
    "noren-selection-toolbar",
  );
  toolbarMount.host.setAttribute("data-theme", cachedTheme);
  document.body.appendChild(toolbarMount.host);

  // If streaming into field, clear the selection first
  if (streamIntoField && targetEl) {
    targetEl.focus();
    if (targetEl instanceof HTMLTextAreaElement || targetEl instanceof HTMLInputElement) {
      const start = targetEl.selectionStart ?? 0;
      const end = targetEl.selectionEnd ?? targetEl.value.length;
      targetEl.value = targetEl.value.slice(0, start) + targetEl.value.slice(end);
      targetEl.selectionStart = targetEl.selectionEnd = start;
    } else if (targetEl.getAttribute("contenteditable") === "true") {
      // Delete selected content, cursor stays at deletion point
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        selection.getRangeAt(0).deleteContents();
      }
    }
  }

  // Gather context signals for voice-aware routing
  const detectedFormat = detectFormatFromUrl();
  let surroundingContext: string | null = null;
  if (action === "reply" || action === "rewrite") {
    const currentSel = window.getSelection();
    if (currentSel) surroundingContext = getSurroundingContext(currentSel);
  }

  // Stream via port connection to background
  const port = chrome.runtime.connect({ name: "quick-action-stream" });
  let streamedText = "";
  let finalContent = "";

  port.onMessage.addListener((event) => {
    if (event.type === "delta") {
      streamedText += event.text;
      // Standard editors: stream text in as it arrives
      if (streamIntoField && !frameworkEditor && targetEl) {
        appendToField(targetEl, event.text);
      }
      // Framework editors: buffer chunks, paste once on done
    } else if (event.type === "done") {
      finalContent = event.content || streamedText;
      port.disconnect();
      dismissToolbar();

      if (streamIntoField && frameworkEditor && targetEl) {
        // Single synthetic paste for framework editors (Draft.js, Lexical)
        appendToField(targetEl, finalContent, true);
      } else if (streamIntoField) {
        // Standard editors: text already streamed in
      } else {
        // No target at start. Check again now (user may have clicked into a field while waiting)
        const lateTarget = getEditableTarget();
        if (lateTarget) {
          const usePaste = isFrameworkEditor(lateTarget);
          appendToField(lateTarget, finalContent, usePaste);
        } else {
          navigator.clipboard.writeText(finalContent).then(() => {
            showCopiedNotification();
          });
        }
      }
    } else if (event.type === "error") {
      port.disconnect();
      dismissToolbar();
      console.error("[Noren] Quick action error:", event.message);
      showErrorNotification(event.message);
    }
  });

  port.onDisconnect.addListener(() => {
    if (!finalContent && !streamedText) {
      dismissToolbar();
      showErrorNotification("Connection lost");
    }
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
  return lastFocusedEditable;
}

function appendToField(el: HTMLElement, text: string, useClipboardEvent = false) {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const pos = el.selectionStart ?? el.value.length;
    el.value = el.value.slice(0, pos) + text + el.value.slice(pos);
    el.selectionStart = el.selectionEnd = pos + text.length;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else if (el.getAttribute("contenteditable") === "true") {
    el.focus();
    if (useClipboardEvent) {
      // Synthetic paste for framework editors (Draft.js, Lexical, etc.)
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

function showErrorNotification(error: string) {
  // Simplify common error messages
  let msg = "Something went wrong";
  const e = error.toLowerCase();
  if (e.includes("api key") || e.includes("401")) msg = "Invalid API key. Check Settings.";
  else if (e.includes("rate") || e.includes("429")) msg = "Rate limit reached. Try again shortly.";
  else if (e.includes("no voice profile") || e.includes("profile")) msg = "No voice profile found.";
  else if (e.includes("network") || e.includes("fetch")) msg = "Network error. Check your connection.";

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
  el.textContent = "Copied to clipboard";

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
