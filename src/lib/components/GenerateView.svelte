<script lang="ts">
  import { generate, generateComparison, listFormats, injectGeneratedText, getProfileOverview, createCheckout, logEdit, type GenerateResult, type ComparisonResult } from "$lib/api/noren";
  import { isFree } from "$lib/stores/subscription.svelte";
  import { friendlyError } from "$lib/utils/errors";
  import LoadingSpinner from "./LoadingSpinner.svelte";
  import NorenMark from "./NorenMark.svelte";

  let { initialContext = "", oncontextused }: { initialContext?: string; oncontextused?: () => void } = $props();

  // --- State ---
  let prompt = $state("");
  let format = $state("general");
  let level: "strict" | "guided" | "light" = $state("guided");
  let mode: "generate" | "adapt" = $state("generate");
  let contextText = $state("");
  let formats = $state<string[]>([]);
  let output = $state<GenerateResult | null>(null);
  let editedText = $state("");
  let comparison = $state<ComparisonResult | null>(null);
  let compareMode = $state(false);
  let isGenerating = $state(false);
  let error = $state("");
  let attachedFiles = $state<{ name: string; content: string }[]>([]);
  let hasProfile = $state(true);
  let showCompareLock = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();

  const levels = ["strict", "guided", "light"] as const;

  // --- Init ---
  $effect(() => {
    getProfileOverview().then((overview) => {
      hasProfile = overview.exists;
      let f = overview.formats;
      if (!f.includes("general")) {
        f = ["general", ...f];
      }
      formats = f;
      if (!f.includes(format)) {
        format = f[0];
      }
    });

    listFormats().then((f) => {
      if (formats.length <= 1) {
        if (!f.includes("general")) {
          f = ["general", ...f];
        }
        formats = f;
      }
    });

  });

  // React to context changes from parent
  $effect(() => {
    if (initialContext) {
      contextText = initialContext;
    } else {
      contextText = "";
    }
  });

  // --- Actions ---
  async function handleGenerate() {
    if (!prompt.trim() || isGenerating) return;

    isGenerating = true;
    error = "";
    output = null;
    oncontextused?.();
    comparison = null;

    try {
      const attachmentContents = attachedFiles.length > 0
        ? attachedFiles.map((f) => f.content)
        : undefined;

      if (compareMode) {
        comparison = await generateComparison({
          prompt: prompt.trim(),
          format,
          context: contextText || undefined,
          attachments: attachmentContents,
        });
        output = comparison.with_voice;
      } else {
        output = await generate({
          prompt: prompt.trim(),
          format,
          level,
          mode: mode !== "generate" ? mode : undefined,
          context: contextText || undefined,
          attachments: attachmentContents,
        });
      }
      if (output) {
        editedText = output.text;
        weaveComplete = true;
        setTimeout(() => { weaveComplete = false; }, 1000);
        try {
          await navigator.clipboard.writeText(output.text);
          copied = true;
        } catch {
          // Clipboard API may not be available
        }
      }
    } catch (e) {
      error = friendlyError(e);
    } finally {
      isGenerating = false;
    }
  }

  let copied = $state(false);
  let weaveComplete = $state(false);

  async function handleCopy() {
    if (!output) return;
    const text = editedText || output.text;
    await navigator.clipboard.writeText(text);
    if (editedText && editedText !== output.text) {
      logEdit(format, output.text, editedText).catch(() => {});
    }
    copied = true;
    setTimeout(() => { copied = false; }, 1500);
  }

  async function handleInject() {
    if (!output) return;
    const text = editedText || output.text;
    try {
      if (editedText && editedText !== output.text) {
        logEdit(format, output.text, editedText).catch(() => {});
      }
      await injectGeneratedText(text);
    } catch (e) {
      error = friendlyError(e);
    }
  }

  function clearContext() {
    contextText = "";
  }

  async function handleAttachFile() {
    if (attachedFiles.length >= 3) {
      error = "Maximum 3 attachments allowed";
      return;
    }
    fileInput?.click();
  }

  async function handleFileSelected(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const content = await file.text();
      attachedFiles = [...attachedFiles, { name: file.name, content }];
    } catch (err) {
      error = friendlyError(err);
    }
    input.value = "";
  }

  function removeAttachment(index: number) {
    attachedFiles = attachedFiles.filter((_, i) => i !== index);
  }
</script>

<!-- Hidden file input -->
<input
  bind:this={fileInput}
  type="file"
  accept=".txt,.md,.csv,.json,.xml,.html,.yaml,.yml,.toml"
  onchange={handleFileSelected}
  class="hidden"
/>

<div class="flex flex-col h-full animate-fade-in-up">
  <!-- View title -->
  <div class="px-4 pt-4 pb-2 shrink-0">
    <h1 class="font-heading italic text-[21px] text-foreground font-normal">Weave</h1>
  </div>

  <!-- Toolbar -->
  <div class="flex items-center gap-2 px-4 pb-3 shrink-0">
    <select
      bind:value={format}
      class="px-2 py-1 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
    >
      {#each formats as fmt}
        <option value={fmt}>{fmt}</option>
      {/each}
    </select>
    <button
      onclick={handleAttachFile}
      class="px-2 py-1 text-[10px] bg-surface text-muted border border-border hover:border-secondary hover:text-foreground transition-colors cursor-pointer rounded-md"
      title="Attach a file"
      disabled={attachedFiles.length >= 3}
    >
      Attach{#if attachedFiles.length > 0} ({attachedFiles.length}/3){/if}
    </button>

    <div class="flex items-center gap-1.5 ml-auto">
      <!-- Adapt toggle -->
      <button
        onclick={() => { mode = mode === "generate" ? "adapt" : "generate"; }}
        class="px-2 py-1 text-[10px] transition-colors cursor-pointer rounded-md
          {mode === 'adapt'
            ? 'bg-secondary text-white font-medium'
            : 'bg-surface text-muted border border-border hover:border-secondary hover:text-foreground'}"
        title={mode === "adapt" ? "Adapts existing text to your voice" : "Switch to adapt mode: restyle existing text in your voice"}
      >
        Adapt
      </button>

      <!-- Compare toggle -->
      <div class="relative">
        <button
          onclick={() => {
            if (isFree()) {
              showCompareLock = true;
              setTimeout(() => { showCompareLock = false; }, 3000);
              return;
            }
            compareMode = !compareMode;
          }}
          class="px-2 py-1 text-[10px] transition-colors cursor-pointer rounded-md
            {compareMode
              ? 'bg-secondary text-white font-medium'
              : 'bg-surface text-muted border border-border hover:border-secondary hover:text-foreground'}"
          title={isFree() ? "Compare requires Pro" : "Compare with and without your voice"}
        >
          Compare
          {#if isFree()}
            <span class="ml-0.5 text-[8px] text-secondary font-medium">PRO</span>
          {/if}
        </button>
        {#if showCompareLock}
          <div class="absolute top-full mt-1 right-0 z-10 p-2 bg-tint border border-secondary/20 rounded-xl whitespace-nowrap animate-fade-in-up" style="box-shadow: var(--shadow-dropdown)">
            <p class="text-[10px] text-muted">Compare is a <span class="text-secondary font-medium">Pro</span> feature.</p>
            <button
              onclick={async () => { try { const r = await createCheckout("pro"); if (r.checkout_url !== "dev://granted") window.open(r.checkout_url, "_blank"); } catch {} }}
              class="mt-1 text-[10px] text-secondary font-medium cursor-pointer hover:text-foreground uppercase tracking-wide"
            >Upgrade</button>
          </div>
        {/if}
      </div>

      {#if !compareMode}
        <div class="flex gap-1">
          {#each levels as lvl}
            <button
              onclick={() => { level = lvl; }}
              class="px-1.5 py-1 text-[10px] transition-colors cursor-pointer uppercase tracking-wide rounded-md
                {level === lvl
                  ? 'bg-primary text-white font-medium'
                  : 'bg-surface text-muted border border-border hover:border-secondary hover:text-foreground'}"
              title={lvl === "strict"
                ? "Strict: maximizes voice fidelity, may constrain creativity"
                : lvl === "guided"
                  ? "Guided: balances your voice with natural flow (recommended)"
                  : "Light: uses your voice as a gentle guide, more creative freedom"}
            >
              {lvl}
            </button>
          {/each}
        </div>
      {/if}

      <!-- Voice badge -->
      {#if hasProfile}
        <div class="voice-badge">
          <div class="voice-badge-dot"></div>
          <span class="font-mono text-[8px] font-medium uppercase tracking-wide text-signal">Voice</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- No profile nudge -->
  {#if !hasProfile}
    <div class="flex items-center gap-2 mx-4 mb-3 p-2 bg-tint border border-secondary/20 rounded-xl">
      <p class="flex-1 text-[10px] text-muted leading-relaxed">
        No voice profile yet, output will be generic.
        <button
          onclick={() => window.open("https://usenoren.ai", "_blank")}
          class="text-secondary font-medium cursor-pointer hover:text-foreground"
        >Upgrade to Pro</button> for AI extraction.
      </p>
    </div>
  {/if}

  <!-- Output area -->
  <div class="flex-1 min-h-0 overflow-y-auto px-4">
    {#if !comparison && !output}
      <div class="flex-1 flex flex-col items-center justify-center gap-3">
        <div class="opacity-15 animate-panel-sway" style="color: var(--color-primary)">
          <NorenMark width={40} height={48} />
        </div>
        <p class="text-display text-foreground/80">Ready to weave</p>
        <p class="text-xs text-muted">Your voice is loaded and ready</p>
      </div>
    {:else if comparison}
      <div class="flex flex-col gap-2 h-full animate-fabric-unfurl">
        <div class="flex-1 grid grid-cols-2 gap-2 min-h-0">
          <div class="flex flex-col min-h-0">
            <span class="font-heading italic text-[11px] text-accent mb-1 tracking-wide">With your voice</span>
            <div class="flex-1 p-4 overflow-y-auto output-card output-weave-bg">
              <div class="animate-shimmer rounded-lg">
                <p class="font-heading italic text-xs text-foreground whitespace-pre-wrap animate-text-weave" style="line-height:1.75">{comparison.with_voice.text}</p>
              </div>
            </div>
          </div>
          <div class="flex flex-col min-h-0">
            <span class="font-heading italic text-[11px] text-muted mb-1 tracking-wide">Without voice</span>
            <div class="flex-1 p-4 bg-surface border border-border rounded-xl overflow-y-auto opacity-75">
              <div class="animate-shimmer rounded-lg">
                <p class="text-xs text-foreground whitespace-pre-wrap" style="line-height:1.75">{comparison.without_voice.text}</p>
              </div>
            </div>
          </div>
        </div>

        <div class="flex items-center pb-2">
          <span class="font-mono text-[9px] text-muted mr-auto">
            {comparison.with_voice.input_tokens + comparison.with_voice.output_tokens + comparison.without_voice.input_tokens + comparison.without_voice.output_tokens} tokens
          </span>
          <div class="flex gap-2">
            <button
              onclick={handleCopy}
              class="w-8 h-8 flex items-center justify-center border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
              title={copied ? "Copied" : "Copy voiced"}
            >
              {#if copied}
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
              {:else}
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"/></svg>
              {/if}
            </button>
            <button
              onclick={handleInject}
              class="px-3 py-1.5 text-xs text-white transition-colors cursor-pointer rounded-md font-medium bg-accent"
            >
              Inject voiced
            </button>
          </div>
        </div>
      </div>
    {:else if output}
      <div class="flex flex-col gap-2 h-full animate-fabric-unfurl">
        <!-- Voice badge + format pills -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <span class="font-heading italic text-[11px] text-muted tracking-wide">{format}</span>
            <span class="font-heading italic text-[11px] text-muted tracking-wide">{level}</span>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto output-card output-weave-bg min-h-0">
          <textarea
            bind:value={editedText}
            class="w-full h-full p-4 font-heading italic text-[15px] text-foreground bg-transparent resize-none border-none focus:outline-none selectable animate-text-weave"
            style="line-height:1.85;letter-spacing:-0.2px"
          ></textarea>
        </div>

        <div class="flex items-center pb-2">
          <div class="flex items-center gap-2 mr-auto">
            <span class="font-mono text-[9px] text-muted">
              {output.input_tokens + output.output_tokens} tokens
            </span>
            {#if editedText !== output.text}
              <span class="text-[9px] text-secondary font-medium">edited</span>
            {/if}
          </div>
          <div class="flex gap-2">
            <button
              onclick={handleCopy}
              class="w-8 h-8 flex items-center justify-center border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
              title={copied ? "Copied" : "Copy"}
            >
              {#if copied}
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
              {:else}
                <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"/></svg>
              {/if}
            </button>
            <button
              onclick={handleInject}
              class="px-3 py-1.5 text-xs text-white transition-colors cursor-pointer rounded-md font-medium bg-accent"
            >
              Inject
            </button>
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Error -->
  {#if error}
    <div class="mx-4 mb-2 p-3 bg-tint border border-border rounded-xl text-xs text-muted leading-relaxed shrink-0">
      {error}
    </div>
  {/if}

  <!-- Input bar (bottom-pinned) -->
  <div class="shrink-0 border-t border-border px-4 py-3">
    <!-- Context banner -->
    {#if contextText}
      <div class="flex items-start gap-2 mb-2 px-3 py-2 bg-tint/50 border border-border rounded-xl text-xs">
        <div class="flex-1 min-w-0">
          <span class="font-medium text-secondary">Context:</span>
          <span class="text-muted ml-1">
            {contextText.length > 150 ? contextText.slice(0, 150) + "..." : contextText}
          </span>
        </div>
        <button
          onclick={clearContext}
          class="text-muted hover:text-foreground shrink-0 cursor-pointer"
          aria-label="Clear context"
        >&times;</button>
      </div>
    {/if}

    <!-- Attachments -->
    {#if attachedFiles.length > 0}
      <div class="flex items-center gap-1.5 flex-wrap mb-1.5">
        {#each attachedFiles as file, i}
          <div class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-tint border border-border rounded text-[10px] text-secondary">
            <span class="max-w-[120px] truncate">{file.name}</span>
            <button
              onclick={() => removeAttachment(i)}
              class="text-muted hover:text-error cursor-pointer ml-0.5"
              aria-label="Remove attachment"
            >&times;</button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="flex items-end gap-2">
      <textarea
        bind:value={prompt}
        onkeydown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleGenerate(); }}
        class="flex-1 p-3 text-sm resize-none bg-surface text-foreground placeholder-muted border border-border rounded-xl focus:outline-none focus:border-secondary"
        style="box-shadow: var(--shadow-inset)"
        rows={1}
        placeholder={mode === "adapt" ? "Paste content to restyle in your voice..." : "What do you want to write?"}
        disabled={isGenerating}
      ></textarea>
      <button
        onclick={handleGenerate}
        disabled={!prompt.trim() || isGenerating}
        class="p-2.5 rounded-xl transition-colors cursor-pointer shrink-0
          {!prompt.trim() || isGenerating
            ? 'bg-surface text-muted border border-border cursor-not-allowed opacity-50'
            : 'bg-accent text-white hover:bg-accent-hover'}
          {weaveComplete ? 'animate-loom-pulse' : ''}"
        style={!(!prompt.trim() || isGenerating) ? 'box-shadow: 0 0 12px var(--color-accent-glow)' : ''}
        aria-label="Weave"
      >
        {#if isGenerating}
          <LoadingSpinner />
        {:else}
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        {/if}
      </button>
    </div>
  </div>
</div>
