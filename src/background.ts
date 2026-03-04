// Noren — Chrome extension service worker

// Register context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "noren-weave",
    title: "Weave with Noren",
    contexts: ["selection"],
  });
});

// Handle context menu click — store selected text, open popup window
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === "noren-weave" && info.selectionText) {
    await chrome.storage.session.set({ context_text: info.selectionText });

    // Open popup.html in a standalone window (MV3 can't open the popup programmatically)
    const popupURL = chrome.runtime.getURL("popup.html?source=context-menu");
    chrome.windows.create({
      url: popupURL,
      type: "popup",
      width: 440,
      height: 580,
      focused: true,
    });
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
