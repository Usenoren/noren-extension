<script lang="ts">
  let { x, y, onAction, loading = false, below = false }: {
    x: number;
    y: number;
    onAction: (action: string, intent?: string) => void;
    loading?: boolean;
    below?: boolean;
  } = $props();

  let replyMode = $state(false);
  let intentText = $state("");
  let inputEl: HTMLInputElement;

  const actions = [
    { id: "rewrite", label: "Rewrite" },
    { id: "reply", label: "Reply" },
    { id: "fix", label: "Fix" },
  ];

  function handleAction(id: string) {
    if (id === "reply") {
      replyMode = true;
      setTimeout(() => inputEl?.focus(), 0);
    } else {
      onAction(id);
    }
  }

  function submitReply() {
    onAction("reply", intentText.trim() || undefined);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      submitReply();
    } else if (e.key === "Escape") {
      e.preventDefault();
      replyMode = false;
      intentText = "";
    }
  }
</script>

<div
  class="noren-toolbar"
  class:noren-below={below}
  class:noren-reply-mode={replyMode}
  class:noren-loading-mode={loading}
  style="left: {x}px; top: {y}px;"
>
  {#if loading}
    <div class="noren-loading noren-morph-enter">
      <span class="noren-spinner"></span>
      <span class="noren-loading-text">Weaving...</span>
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
      <button class="noren-reply-send" onclick={submitReply}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 8h10M9 4l4 4-4 4"/>
        </svg>
      </button>
    </div>
  {:else}
    {#each actions as action}
      <button
        class="noren-action"
        onclick={() => handleAction(action.id)}
      >
        {action.label}
      </button>
    {/each}
  {/if}
</div>
