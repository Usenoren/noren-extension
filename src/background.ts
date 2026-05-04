// Noren — Chrome extension service worker

import { generate, generateStream } from "$lib/api/noren";

// Strip Origin header where providers reject browser-extension origins.
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1, 2],
  addRules: [
    {
      id: 1,
      priority: 1,
      action: {
        type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
        requestHeaders: [
          {
            header: "Origin",
            operation: "remove" as chrome.declarativeNetRequest.HeaderOperation,
          },
        ],
      },
      condition: {
        urlFilter: "||api.anthropic.com/",
        resourceTypes: [
          "xmlhttprequest" as chrome.declarativeNetRequest.ResourceType,
          "other" as chrome.declarativeNetRequest.ResourceType,
        ],
      },
    },
    {
      id: 2,
      priority: 1,
      action: {
        type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
        requestHeaders: [
          {
            header: "Origin",
            operation: "remove" as chrome.declarativeNetRequest.HeaderOperation,
          },
        ],
      },
      condition: {
        regexFilter: "^http://(localhost|127\\.0\\.0\\.1)(:[0-9]+)?/",
        resourceTypes: [
          "xmlhttprequest" as chrome.declarativeNetRequest.ResourceType,
          "other" as chrome.declarativeNetRequest.ResourceType,
        ],
      },
    },
  ],
}).then(() => console.log("[dnr] Origin-strip rules active"))
  .catch((e) => console.error("[dnr] rule failed:", e));

// Register context menu + side panel behavior on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "noren-weave",
    title: "Weave with Noren",
    contexts: ["selection"],
  });

  // Apply saved click behavior (default: side panel)
  chrome.storage.local.get("click_opens_sidepanel").then(({ click_opens_sidepanel }) => {
    const openSidePanel = click_opens_sidepanel !== false; // default true
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: openSidePanel });
    if (openSidePanel) {
      chrome.action.setPopup({ popup: "" });
    } else {
      chrome.action.setPopup({ popup: "popup.html" });
    }
  });
});

// Listen for setting changes to toggle click behavior
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.click_opens_sidepanel) {
    const openSidePanel = changes.click_opens_sidepanel.newValue !== false;
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: openSidePanel });
    if (openSidePanel) {
      chrome.action.setPopup({ popup: "" });
    } else {
      chrome.action.setPopup({ popup: "popup.html" });
    }
  }
});

// Handle context menu click — store selected text, open side panel
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "noren-weave" && info.selectionText) {
    // Open side panel first — must be synchronous to preserve user gesture
    if (tab?.windowId) {
      chrome.sidePanel.open({ windowId: tab.windowId });
    }
    // Store selected text (no await — gesture must not be broken)
    chrome.storage.session.set({ context_text: info.selectionText });
  }
});

// Quick action prompt templates
// rewrite/reply: voice profile injected via system prompt in byokGenerate
// fix: no voice profile (purely mechanical)
// No per-platform length map. The reply prompt handles length naturally.

const QUICK_ACTION_PROMPTS: Record<string, (text: string, ctx?: string | null, intent?: string | null, format?: string | null) => string> = {
  rewrite: (text, ctx, intent) => {
    let prompt = intent
      ? `Apply this edit instruction to the draft below in my voice. Return only the edited text.\n\nInstruction: ${intent}`
      : `Edit this draft. Fix errors and make targeted improvements. Do not restyle. Return only the edited text.`;
    if (ctx) prompt += `\n\nSurrounding context (do not include in output, use for coherence only):\n${ctx}`;
    return `${prompt}\n\n${text}`;
  },
  reply: (text, ctx, intent, format) => {
    let prompt = `Reply to this post in my voice. Keep it short. Return only the reply.`;
    if (intent) prompt += `\n\nDirection (use as the angle, do not repeat verbatim): ${intent}`;
    if (ctx) prompt += `\n\nSurrounding context:\n${ctx}`;
    return `${prompt}\n\nPost to engage with:\n${text}`;
  },
  fix: (text) =>
    `Fix grammar, spelling, and punctuation. Make no stylistic changes. Return only the corrected text.\n\n${text}`,
};

// Message relay
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Context menu text retrieval
  if (message.type === "get-context-from-menu") {
    chrome.storage.session.get("context_text").then((result) => {
      sendResponse({ text: result.context_text || null });
      chrome.storage.session.remove("context_text");
    });
    return true;
  }

  // Proxy fetch through background worker to bypass CORS
  if (message.type === "proxy-fetch") {
    const { url, init } = message;
    console.log("[proxy-fetch] URL:", url);
    console.log("[proxy-fetch] Headers:", JSON.stringify(init?.headers));
    fetch(url, init)
      .then((res) => res.text().then((text) => {
        console.log("[proxy-fetch] Response:", res.status, text.slice(0, 200));
        return { ok: res.ok, status: res.status, text };
      }))
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.error("[proxy-fetch] Error:", err);
        sendResponse({ ok: false, status: 0, text: String(err) });
      });
    return true;
  }
});

// Port-based streaming for quick actions
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "quick-action-stream") return;

  port.onMessage.addListener(async (message) => {
    const { action, text, detectedFormat, surroundingContext, intent } = message;
    const promptFn = QUICK_ACTION_PROMPTS[action] || QUICK_ACTION_PROMPTS.rewrite;
    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort("User cancelled"));

    // MV3 service worker idle timer only resets on chrome.* event activity.
    // Pre-stream silence on slow generations would let it die at 30s, killing
    // the fetch. A periodic port message counts as chrome.runtime activity
    // on both ends and keeps the SW (and the port) alive.
    const keepAlive = setInterval(() => {
      try {
        port.postMessage({ type: "ping" });
      } catch {
        // Port already disconnected — interval will be cleared below.
      }
    }, 20_000);

    try {
      const stream = generateStream({
        prompt: promptFn(text, surroundingContext, intent, detectedFormat),
        format: action !== "fix" ? (detectedFormat || "general") : "general",
        level: "guided",
        quickAction: action,
        mode: "generate",
        signal: controller.signal,
      });

      for await (const event of stream) {
        if (event.type === "delta") {
          port.postMessage({ type: "delta", text: event.text });
        } else if (event.type === "done") {
          port.postMessage({ type: "done", content: event.content });
        } else if (event.type === "error") {
          port.postMessage({ type: "error", message: event.message });
        }
      }
    } catch (e) {
      try {
        port.postMessage({ type: "error", message: String(e) });
      } catch {
        // Port already disconnected
      }
    } finally {
      clearInterval(keepAlive);
    }
  });
});
