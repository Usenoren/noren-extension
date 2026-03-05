// Noren — Chrome extension service worker

// Register context menu + side panel behavior on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "noren-weave",
    title: "Weave with Noren",
    contexts: ["selection"],
  });

  // Toolbar icon click opens popup (not side panel).
  // Side panel is opened explicitly by context menu / floating button / quick actions.
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

// Handle context menu click — store selected text, open side panel
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "noren-weave" && info.selectionText) {
    await chrome.storage.session.set({ context_text: info.selectionText });

    if (tab?.windowId) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  }
});

// Quick action prompt templates
const QUICK_ACTION_PROMPTS: Record<string, (text: string) => string> = {
  rewrite: (text) =>
    `Rewrite the following text, keeping the same meaning but improving clarity and flow. Return ONLY the rewritten text, no explanations:\n\n${text}`,
  shorten: (text) =>
    `Make the following text more concise while keeping the key meaning. Return ONLY the shortened text:\n\n${text}`,
  expand: (text) =>
    `Expand the following text with more detail and depth. Return ONLY the expanded text:\n\n${text}`,
  fix: (text) =>
    `Fix any grammar, spelling, and punctuation errors in the following text. Return ONLY the corrected text:\n\n${text}`,
  tone: (text) =>
    `Adjust the tone of the following text to be more professional and polished. Return ONLY the adjusted text:\n\n${text}`,
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

  // Open side panel from content script (floating button)
  if (message.type === "open-side-panel") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (tab?.windowId) {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  // Quick action from selection toolbar
  if (message.type === "quick-action") {
    const { action, text } = message;
    const promptFn = QUICK_ACTION_PROMPTS[action] || QUICK_ACTION_PROMPTS.rewrite;

    import("$lib/api/noren").then(async ({ generate }) => {
      try {
        const result = await generate({
          prompt: promptFn(text),
          format: "general",
          level: "guided",
        });
        sendResponse({ result: result.text });
      } catch (e) {
        sendResponse({ error: String(e) });
      }
    });
    return true;
  }
});
