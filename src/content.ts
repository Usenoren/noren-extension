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

function injectText(text: string) {
  const el = document.activeElement;

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
    document.execCommand("insertText", false, text);
  } else {
    document.execCommand("insertText", false, text);
  }
}

// ============================================================
// Selection Toolbar — appears on text selection
// ============================================================

let toolbarMount: ShadowMountResult | null = null;
let processingAction = false;

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

    showToolbar(rect.left + rect.width / 2, rect.top, text);
  }, 10);
});

document.addEventListener("mousedown", (e) => {
  if (!toolbarMount) return;
  if (processingAction) return;
  const path = e.composedPath();
  if (!path.includes(toolbarMount.host)) {
    dismissToolbar();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") dismissToolbar();
});

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

function showToolbar(x: number, y: number, selectedText: string) {
  dismissToolbar();

  // Clamp x to viewport
  const cx = Math.max(120, Math.min(x, window.innerWidth - 120));

  toolbarMount = createShadowMount(
    SelectionToolbar as any,
    {
      x: cx,
      y,
      loading: false,
      onAction: (action: string) => handleQuickAction(action, selectedText),
    },
    toolbarCss,
    "noren-selection-toolbar",
  );
  document.body.appendChild(toolbarMount.host);
}

function dismissToolbar() {
  if (toolbarMount) {
    toolbarMount.destroy();
    toolbarMount = null;
  }
  processingAction = false;
}

async function handleQuickAction(action: string, text: string) {
  processingAction = true;

  // Show loading state — recreate toolbar with loading=true
  const sel = window.getSelection();
  let tx = window.innerWidth / 2, ty = 100;
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0).getBoundingClientRect();
    tx = r.left + r.width / 2;
    ty = r.top;
  }

  // Destroy old toolbar, create loading one
  if (toolbarMount) {
    toolbarMount.destroy();
    toolbarMount = null;
  }

  toolbarMount = createShadowMount(
    SelectionToolbar as any,
    { x: Math.max(120, Math.min(tx, window.innerWidth - 120)), y: ty, loading: true, onAction: () => {} },
    toolbarCss,
    "noren-selection-toolbar",
  );
  document.body.appendChild(toolbarMount.host);

  try {
    const response = await chrome.runtime.sendMessage({
      type: "quick-action",
      action,
      text,
    });

    dismissToolbar();

    if (response?.result) {
      // Check if we're in an editable field — inject there
      const el = document.activeElement;
      if (
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLInputElement ||
        el?.getAttribute("contenteditable") === "true"
      ) {
        injectText(response.result);
      } else {
        // Read-only context — copy to clipboard
        await navigator.clipboard.writeText(response.result);
        showCopiedNotification();
      }
    } else if (response?.error) {
      dismissToolbar();
      console.error("[Noren] Quick action error:", response.error);
    }
  } catch (e) {
    dismissToolbar();
    console.error("[Noren] Quick action failed:", e);
  }
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
