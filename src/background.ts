// Noren — Chrome extension service worker

import { generate } from "$lib/api/noren";

// Strip Origin header on Anthropic API requests (runs every service worker start)
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1],
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
  ],
}).then(() => console.log("[dnr] Origin-strip rule active"))
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

// Quick action prompt templates (voice-aware: shorten/expand inject profile, fix does not)
const QUICK_ACTION_PROMPTS: Record<string, (text: string, surroundingContext?: string | null) => string> = {
  shorten: (text) =>
    `Make this more concise while preserving the core meaning and my voice. Return only the shortened text.\n\n${text}`,
  expand: (text, surroundingContext) => {
    let prompt = `Expand this with more detail and depth, writing in my voice. Return only the expanded text.`;
    if (surroundingContext) {
      prompt += `\n\nSurrounding context (for coherence, do not include this in your output):\n${surroundingContext}`;
    }
    return `${prompt}\n\n${text}`;
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

  // Quick action from selection toolbar (voice-aware)
  if (message.type === "quick-action") {
    const { action, text, detectedFormat, surroundingContext } = message;
    const promptFn = QUICK_ACTION_PROMPTS[action] || QUICK_ACTION_PROMPTS.shorten;

    (async () => {
      try {
        const result = await generate({
          prompt: promptFn(text, surroundingContext),
          format: action !== "fix" ? (detectedFormat || "general") : "general",
          level: "guided",
          quickAction: action,
        });
        sendResponse({ result: result.text });
      } catch (e) {
        sendResponse({ error: String(e) });
      }
    })();
    return true;
  }
});
