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

<div class="noren-toolbar" class:noren-below={below} class:noren-reply-mode={replyMode} style="left: {x}px; top: {y}px;">
  {#if loading}
    <div class="noren-loading">
      <span class="noren-spinner"></span>
      <span>Weaving...</span>
    </div>
  {:else if replyMode}
    <input
      bind:this={inputEl}
      bind:value={intentText}
      class="noren-reply-input"
      placeholder="Your take? Even 1 word helps"
      onkeydown={handleKeydown}
    />
    <button class="noren-action noren-send" onclick={submitReply}>
      &rarr;
    </button>
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
