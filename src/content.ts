// Noren — Content script for text capture and injection

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "get-selection") {
    const text = window.getSelection()?.toString() || "";
    sendResponse({ text });
    return;
  }

  if (message.type === "inject-text") {
    const text = message.text as string;
    const el = document.activeElement;

    if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
      // For standard form elements
      el.focus();
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (el?.getAttribute("contenteditable") === "true") {
      // For contenteditable elements (Gmail compose, etc.)
      el.focus();
      document.execCommand("selectAll", false);
      document.execCommand("insertText", false, text);
    } else {
      // Fallback: try execCommand on whatever is focused
      document.execCommand("insertText", false, text);
    }

    sendResponse({ success: true });
    return;
  }
});
