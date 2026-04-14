<script lang="ts">
  import { repurpose, getContextText, type RepurposeFormatResult } from "$lib/api/noren";
  import { friendlyError } from "$lib/utils/errors";
  import loomIdleUrl from "../../assets/loom-idle.png";
  import LoadingSpinner from "./LoadingSpinner.svelte";

  // Flip to true when ready to ship
  const FEATURE_ENABLED = false;

  const FORMAT_FAMILIES = [
    { label: "Long-form", formats: ["blog", "article", "newsletter", "essay", "longform"] },
    { label: "Social", formats: ["tweet", "twitter", "thread"] },
    { label: "Messaging", formats: ["email", "slack"] },
    { label: "Professional", formats: ["linkedin", "memo"] },
  ];

  const ALL_FORMATS = FORMAT_FAMILIES.flatMap((f) => f.formats);

  // --- State ---
  let sourceFormat = $state("blog");
  let sourceContent = $state("");
  let targetChecked = $state<Record<string, boolean>>({});
  let isProcessing = $state(false);
  let error = $state("");
  let results = $state<RepurposeFormatResult[]>([]);
  let activeTab = $state("");
  let copiedTab = $state("");
  let totalInputTokens = $state(0);
  let totalOutputTokens = $state(0);
  const sourceFormatSelectId = "repurpose-source-format";
  const targetFormatsGroupId = "repurpose-target-formats";

  // Init targets: all except source format's family
  function resetTargets() {
    const sourceFamily = FORMAT_FAMILIES.find((f) => f.formats.includes(sourceFormat));
    const exclude = new Set(sourceFamily?.formats || [sourceFormat]);
    const checked: Record<string, boolean> = {};
    for (const fmt of ALL_FORMATS) {
      checked[fmt] = !exclude.has(fmt);
    }
    targetChecked = checked;
  }
  resetTargets();

  // Reset targets when source format changes
  $effect(() => {
    sourceFormat;
    resetTargets();
    results = [];
    activeTab = "";
  });

  const selectedTargets = $derived(
    Object.entries(targetChecked)
      .filter(([_, v]) => v)
      .map(([k]) => k)
  );

  const canRepurpose = $derived(
    sourceContent.trim().length > 0 && selectedTargets.length > 0 && !isProcessing
  );

  const activeResult = $derived(results.find((r) => r.format === activeTab));

  // --- Actions ---
  async function handleGrabContext() {
    try {
      const text = await getContextText();
      if (text) sourceContent = text;
    } catch {}
  }

  async function handleRepurpose() {
    if (!canRepurpose) return;
    isProcessing = true;
    error = "";
    results = [];
    activeTab = "";

    try {
      const resp = await repurpose({
        sourceContent: sourceContent.trim(),
        sourceFormat,
        targetFormats: selectedTargets,
      });
      results = resp.results;
      totalInputTokens = resp.total_input_tokens;
      totalOutputTokens = resp.total_output_tokens;
      if (results.length > 0) {
        activeTab = results[0].format;
      }
    } catch (e) {
      error = friendlyError(e);
    } finally {
      isProcessing = false;
    }
  }

  async function handleCopy(format: string) {
    const r = results.find((r) => r.format === format);
    if (!r) return;
    try {
      await navigator.clipboard.writeText(r.content);
      copiedTab = format;
      setTimeout(() => { copiedTab = ""; }, 1500);
    } catch {}
  }
</script>

<div class="flex flex-col h-full animate-fade-in-up">
  <div class="px-4 pt-4 pb-2 shrink-0">
    <h1 class="font-heading italic text-[21px] text-foreground font-normal">Repurpose</h1>
  </div>

  {#if !FEATURE_ENABLED}
    <!-- Coming soon -->
    <div class="flex-1 flex flex-col items-center justify-center px-6">
      <img src={loomIdleUrl} alt="" class="w-[100px] mb-4 loom-idle-img" />
      <p class="text-sm text-foreground font-medium mb-1">Coming soon</p>
      <p class="text-xs text-muted text-center leading-relaxed">
        Transform a blog post into tweets, emails, and LinkedIn posts. One piece of content, every format, all in your voice.
      </p>
    </div>
  {:else if results.length === 0}
    <!-- Input mode -->
    <div class="flex-1 min-h-0 flex flex-col overflow-hidden px-4">
      <!-- Source format + grab context -->
      <div class="flex items-center gap-2 pb-2 shrink-0">
        <label for={sourceFormatSelectId} class="text-[10px] text-muted uppercase tracking-wide font-medium">From</label>
        <select
          id={sourceFormatSelectId}
          bind:value={sourceFormat}
          class="px-2 py-1 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
        >
          {#each ALL_FORMATS as fmt}
            <option value={fmt}>{fmt}</option>
          {/each}
        </select>

        <button
          onclick={handleGrabContext}
          class="ml-auto inline-flex items-center gap-1 px-2 py-1 text-[10px] text-muted border border-transparent hover:bg-surface hover:border-border hover:text-foreground transition-colors cursor-pointer rounded-md"
        >
          <svg class="w-[13px] h-[13px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M13.8 12H3"/>
          </svg>
          Use selected
        </button>
      </div>

      <!-- Source content -->
      <textarea
        bind:value={sourceContent}
        class="flex-1 min-h-[120px] p-3 text-sm resize-none bg-surface text-foreground placeholder-muted border border-border rounded-xl focus:outline-none focus:border-secondary"
        style="box-shadow: var(--shadow-inset)"
        placeholder="Paste the content you want to repurpose..."
        disabled={isProcessing}
      ></textarea>

      <!-- Target formats -->
      <div class="pt-3 pb-2 shrink-0">
        <label for={targetFormatsGroupId} class="text-[10px] text-muted uppercase tracking-wide font-medium mb-1.5 block">To</label>
        <div id={targetFormatsGroupId} class="flex flex-col gap-1.5">
          {#each FORMAT_FAMILIES as family}
            {@const visibleFormats = family.formats.filter((f) => f !== sourceFormat)}
            {#if visibleFormats.length > 0}
              <div class="flex items-center gap-1.5 flex-wrap">
                {#each visibleFormats as fmt}
                  <label
                    class="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded cursor-pointer transition-colors
                      {targetChecked[fmt]
                        ? 'bg-accent/10 text-accent border border-accent/20'
                        : 'bg-surface text-muted border border-border hover:border-secondary/30'}"
                  >
                    <input
                      type="checkbox"
                      bind:checked={targetChecked[fmt]}
                      class="hidden"
                    />
                    {fmt}
                  </label>
                {/each}
              </div>
            {/if}
          {/each}
        </div>
      </div>
    </div>

    <!-- Error -->
    {#if error}
      <div class="mx-4 mb-2 p-3 bg-tint border border-border rounded-xl text-xs text-muted leading-relaxed shrink-0">
        {error}
      </div>
    {/if}

    <!-- Action bar -->
    <div class="shrink-0 border-t border-border px-4 py-3">
      <button
        onclick={handleRepurpose}
        disabled={!canRepurpose}
        class="w-full py-2 text-xs font-medium rounded-xl transition-colors cursor-pointer
          {canRepurpose
            ? 'bg-accent text-white hover:bg-accent-hover'
            : 'bg-surface text-muted border border-border cursor-not-allowed opacity-50'}"
        style={canRepurpose ? 'box-shadow: 0 0 12px var(--color-accent-glow)' : ''}
      >
        {#if isProcessing}
          <span class="inline-flex items-center gap-2">
            <LoadingSpinner />
            Repurposing {selectedTargets.length} format{selectedTargets.length !== 1 ? 's' : ''}...
          </span>
        {:else}
          Repurpose to {selectedTargets.length} format{selectedTargets.length !== 1 ? 's' : ''}
        {/if}
      </button>
    </div>

  {:else}
    <!-- Results mode -->
    <div class="flex-1 min-h-0 flex flex-col overflow-hidden animate-fabric-unfurl">
      <!-- Tabs -->
      <div class="flex items-center gap-0.5 px-4 pb-2 shrink-0 overflow-x-auto">
        {#each results as r}
          <button
            onclick={() => { activeTab = r.format; }}
            class="relative px-2.5 py-1.5 text-[10px] rounded-md transition-colors cursor-pointer whitespace-nowrap
              {activeTab === r.format
                ? 'text-accent font-medium bg-accent/5'
                : 'text-muted hover:text-foreground hover:bg-foreground/[0.04]'}"
          >
            {r.format}
            {#if !r.passed}
              <span class="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-warning"></span>
            {/if}
          </button>
        {/each}

        <!-- Back button -->
        <button
          onclick={() => { results = []; activeTab = ""; }}
          class="ml-auto px-2 py-1 text-[10px] text-muted hover:text-foreground transition-colors cursor-pointer"
        >
          New
        </button>
      </div>

      <!-- Active result -->
      {#if activeResult}
        <div class="flex-1 min-h-0 overflow-y-auto px-4">
          <div class="h-full output-card output-weave-bg">
            <textarea
              value={activeResult.content}
              oninput={(e) => {
                const r = results.find((r) => r.format === activeTab);
                if (r) r.content = (e.target as HTMLTextAreaElement).value;
              }}
              class="w-full h-full p-3 font-heading italic text-[13px] text-foreground bg-transparent resize-none border-none focus:outline-none selectable"
              style="line-height:1.75"
            ></textarea>
          </div>
        </div>

        <!-- Result footer -->
        <div class="flex items-center px-4 py-2 shrink-0 border-t border-border">
          <div class="flex items-center gap-2">
            {#if activeResult.passed}
              <span class="inline-flex items-center gap-1 text-[9px] text-signal">
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                Voice check passed
              </span>
            {:else}
              <span class="inline-flex items-center gap-1 text-[9px] text-warning">
                <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/></svg>
                Voice check flagged
              </span>
            {/if}
          </div>

          <div class="flex items-center gap-2 ml-auto">
            <span class="font-mono text-[9px] text-muted">
              {activeResult.input_tokens + activeResult.output_tokens} tokens
            </span>
            <button
              onclick={() => handleCopy(activeTab)}
              class="w-7 h-7 flex items-center justify-center border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
              title={copiedTab === activeTab ? "Copied" : "Copy"}
            >
              {#if copiedTab === activeTab}
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
              {:else}
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"/></svg>
              {/if}
            </button>
          </div>
        </div>
      {/if}

      <!-- Summary -->
      <div class="shrink-0 px-4 py-1.5 bg-surface/50 border-t border-border">
        <span class="font-mono text-[9px] text-muted">
          {results.length} format{results.length !== 1 ? 's' : ''} generated &middot;
          {totalInputTokens + totalOutputTokens} total tokens
        </span>
      </div>
    </div>
  {/if}
</div>
