// Noren — Chrome extension service worker

// Register context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "noren-weave",
    title: "Weave with Noren",
    contexts: ["selection"],
  });
});

// Handle context menu click — store selected text, open popup
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "noren-weave" && info.selectionText) {
    await chrome.storage.session.set({ context_text: info.selectionText });
    // Opening popup programmatically isn't supported in MV3,
    // but we can badge the icon to hint the user
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#3B6B8A" });
    setTimeout(() => {
      chrome.action.setBadgeText({ text: "" });
    }, 5000);
  }
});

// Relay messages between popup and content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "get-context-from-menu") {
    chrome.storage.session.get("context_text").then((result) => {
      sendResponse({ text: result.context_text || null });
      // Clear after reading
      chrome.storage.session.remove("context_text");
    });
    return true; // async response
  }
});
