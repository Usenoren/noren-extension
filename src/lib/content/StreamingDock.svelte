<svelte:options accessors={true} />

<script lang="ts">
  export let text = "";
  export let label = "";
  export let status = "Weaving...";
  export let done = false;
  export let hint = "";
  export let copyLabel = "Copy";
  export let copiedLabel = "Copied";
  export let onCopy: (() => void) | undefined = undefined;
  export let onClose: (() => void) | undefined = undefined;

  let bodyEl: HTMLDivElement | undefined;
  let copied = false;

  $: if (bodyEl && !done) {
    text;
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  $: if (!done) {
    copied = false;
  }

  function handleCopy() {
    onCopy?.();
    copied = true;
    setTimeout(() => { copied = false; }, 1400);
  }
</script>

<div class="noren-dock noren-dock-enter" class:noren-dock-done={done}>
  <div class="noren-dock-header">
    {#if label}
      <span class="noren-dock-label">{label}</span>
    {/if}
    {#if done}
      <button
        type="button"
        class="noren-dock-close"
        aria-label="Close"
        on:mousedown={(e) => e.preventDefault()}
        on:click={onClose}
      >
        ×
      </button>
    {:else}
      <span class="noren-dock-status">
        <span class="noren-dock-spinner" aria-hidden="true"></span>
        <span>{status}</span>
      </span>
    {/if}
  </div>
  {#if done && hint}
    <div class="noren-dock-instruction">
      <span class="noren-dock-instruction-dot" aria-hidden="true"></span>
      <span>{hint}</span>
    </div>
  {/if}
  <div class="noren-dock-body" bind:this={bodyEl}>{text}</div>
  {#if done}
    <div class="noren-dock-actions">
      <button
        type="button"
        class="noren-dock-btn"
        on:mousedown={(e) => e.preventDefault()}
        on:click={handleCopy}
      >
        {copied ? copiedLabel : copyLabel}
      </button>
    </div>
  {/if}
</div>
