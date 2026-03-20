<script lang="ts">
  let { x, y, onAction, loading = false }: {
    x: number;
    y: number;
    onAction: (action: string) => void;
    loading?: boolean;
  } = $props();

  const actions = [
    { id: "shorten", label: "Shorten" },
    { id: "expand", label: "Expand" },
    { id: "fix", label: "Fix" },
  ];
</script>

<div class="noren-toolbar" style="left: {x}px; top: {y}px;">
  {#if loading}
    <div class="noren-loading">
      <span class="noren-spinner"></span>
      <span>Weaving...</span>
    </div>
  {:else}
    {#each actions as action}
      <button
        class="noren-action"
        onclick={() => onAction(action.id)}
      >
        {action.label}
      </button>
    {/each}
  {/if}
</div>
