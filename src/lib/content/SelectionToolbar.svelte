<script lang="ts">
  let {
    x,
    y,
    onAction,
    loading = false,
    below = false,
    statusText = "",
    previewText = "",
    statusLabel = "",
  }: {
    x: number;
    y: number;
    onAction: (action: string, intent?: string) => void;
    loading?: boolean;
    below?: boolean;
    statusText?: string;
    previewText?: string;
    statusLabel?: string;
  } = $props();

  let replyMode = $state(false);
  let rewriteMode = $state(false);
  let intentText = $state("");
  let inputEl = $state<HTMLInputElement | undefined>(undefined);

  const actions = [
    { id: "rewrite", label: "Rewrite" },
    { id: "reply", label: "Reply" },
    { id: "fix", label: "Fix" },
  ];

  function handleAction(id: string) {
    if (id === "reply") {
      replyMode = true;
      setTimeout(() => inputEl?.focus(), 0);
    } else if (id === "rewrite") {
      rewriteMode = true;
      setTimeout(() => inputEl?.focus(), 0);
    } else {
      onAction(id);
    }
  }

  function submitReply() {
    onAction("reply", intentText.trim() || undefined);
  }

  function submitRewrite() {
    onAction("rewrite", intentText.trim() || undefined);
  }

  function handleKeydown(e: KeyboardEvent) {
    // Stop the keystroke from escaping the shadow DOM and triggering the
    // host page's keyboard shortcuts (Twitter "s", Gmail "o", etc). The
    // input still receives the key normally because we're not preventing
    // its default action — we're just preventing bubble-out.
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      if (rewriteMode) submitRewrite();
      else if (replyMode) submitReply();
    } else if (e.key === "Escape") {
      e.preventDefault();
      replyMode = false;
      rewriteMode = false;
      intentText = "";
    }
  }
</script>

<div
  class="noren-toolbar"
  class:noren-below={below}
  class:noren-reply-mode={replyMode || rewriteMode}
  class:noren-loading-mode={loading}
  class:noren-status-mode={!!statusText && !loading}
  style="left: {x}px; top: {y}px;"
>
  {#if loading}
    <div class="noren-loading noren-morph-enter">
      <span class="noren-spinner"></span>
      <span class="noren-loading-text">Weaving...</span>
    </div>
  {:else if statusText}
    <div class="noren-status noren-morph-enter">
      {#if statusLabel}
        <span class="noren-status-label">{statusLabel}</span>
      {/if}
      <span class="noren-status-text">{statusText}</span>
      {#if previewText}
        <div class="noren-status-preview">{previewText}</div>
      {/if}
    </div>
  {:else if replyMode}
    <div class="noren-reply-container noren-morph-enter">
      <span class="noren-reply-label">Reply</span>
      <div class="noren-reply-divider"></div>
      <input
        bind:this={inputEl}
        bind:value={intentText}
        class="noren-reply-input"
        placeholder="agree, but..."
        onkeydown={handleKeydown}
      />
      <button
        type="button"
        class="noren-reply-send"
        aria-label="Send reply intent"
        onmousedown={(e) => e.preventDefault()}
        onclick={submitReply}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 8h10M9 4l4 4-4 4"/>
        </svg>
      </button>
    </div>
  {:else if rewriteMode}
    <div class="noren-reply-container noren-morph-enter">
      <span class="noren-reply-label">Rewrite</span>
      <div class="noren-reply-divider"></div>
      <input
        bind:this={inputEl}
        bind:value={intentText}
        class="noren-reply-input"
        placeholder="expand, tighten..."
        onkeydown={handleKeydown}
      />
      <button
        type="button"
        class="noren-reply-send"
        aria-label="Send rewrite intent"
        onmousedown={(e) => e.preventDefault()}
        onclick={submitRewrite}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 8h10M9 4l4 4-4 4"/>
        </svg>
      </button>
    </div>
  {:else}
    {#each actions as action}
      <button
        type="button"
        class="noren-action"
        onmousedown={(e) => e.preventDefault()}
        onclick={() => handleAction(action.id)}
      >
        {action.label}
      </button>
    {/each}
  {/if}
</div>
