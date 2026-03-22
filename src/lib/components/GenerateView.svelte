<script lang="ts">
  import { generate, generateStream, generateComparison, listFormats, injectGeneratedText, getProfileOverview, createCheckout, logEdit, type GenerateResult, type ComparisonResult, type FixSpan } from "$lib/api/noren";
  import { isFree } from "$lib/stores/subscription.svelte";
  import { friendlyError } from "$lib/utils/errors";
  import LoadingSpinner from "./LoadingSpinner.svelte";
  import NorenMark from "./NorenMark.svelte";
  import loomIdleUrl from "../../assets/loom-idle.png";

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
  let error = $state("");
  let attachedFiles = $state<{ name: string; content: string }[]>([]);
  let hasProfile = $state(true);
  let showCompareLock = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();

  // --- Streaming state ---
  let phase = $state<"idle" | "streaming" | "polishing" | "done">("idle");
  let streamedText = $state("");
  let cleanedText = $state("");
  let fixSpans = $state<FixSpan[]>([]);
  let cleanupStats = $state<{ found: number; fixed: number } | null>(null);
  let streamTokens = $state({ input: 0, output: 0 });
  let isGenerating = $derived(phase === "streaming" || phase === "polishing");

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

    error = "";
    output = null;
    oncontextused?.();
    comparison = null;
    streamedText = "";
    cleanedText = "";
    fixSpans = [];
    cleanupStats = null;
    streamTokens = { input: 0, output: 0 };

    // Compare mode: non-streaming (comparison needs two results)
    if (compareMode) {
      phase = "streaming";
      try {
        const attachmentContents = attachedFiles.length > 0
          ? attachedFiles.map((f) => f.content)
          : undefined;
        comparison = await generateComparison({
          prompt: prompt.trim(),
          format,
          context: contextText || undefined,
          attachments: attachmentContents,
        });
        output = comparison.with_voice;
        editedText = output.text;
      } catch (e) {
        error = friendlyError(e);
      } finally {
        phase = "done";
      }
      return;
    }

    // Streaming generation
    phase = "streaming";
    let cleanupTimeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const attachmentContents = attachedFiles.length > 0
        ? attachedFiles.map((f) => f.content)
        : undefined;

      for await (const event of generateStream({
        prompt: prompt.trim(),
        format,
        level,
        mode: mode !== "generate" ? mode : undefined,
        context: contextText || undefined,
        attachments: attachmentContents,
      })) {
        if (event.type === "delta") {
          streamedText += event.text;
        } else if (event.type === "done") {
          streamedText = event.content;
          streamTokens = { input: event.input_tokens, output: event.output_tokens };
          // Graceful degradation: if no cleanup event within 2s, finalize
          cleanupTimeout = setTimeout(() => {
            if (phase === "streaming") {
              output = { text: streamedText, input_tokens: streamTokens.input, output_tokens: streamTokens.output };
              editedText = streamedText;
              phase = "done";
              weaveComplete = true;
              setTimeout(() => { weaveComplete = false; }, 1000);
            }
          }, 2000);
        } else if (event.type === "cleanup_start") {
          if (cleanupTimeout) clearTimeout(cleanupTimeout);
          phase = "polishing";
        } else if (event.type === "cleanup_done") {
          if (cleanupTimeout) clearTimeout(cleanupTimeout);
          cleanedText = event.content;
          fixSpans = event.fix_spans || [];
          cleanupStats = { found: event.issues_found, fixed: event.issues_fixed };
          output = { text: event.content, input_tokens: streamTokens.input, output_tokens: streamTokens.output };
          editedText = event.content;
          phase = "done";
          weaveComplete = true;
          setTimeout(() => { weaveComplete = false; }, 1000);
          // Auto-copy
          try { await navigator.clipboard.writeText(event.content); copied = true; } catch {}
        } else if (event.type === "error") {
          error = event.message;
          phase = "idle";
          return;
        }
      }

      // If stream ended without cleanup events (short-form), finalize
      if (phase === "streaming") {
        if (cleanupTimeout) clearTimeout(cleanupTimeout);
        output = { text: streamedText, input_tokens: streamTokens.input, output_tokens: streamTokens.output };
        editedText = streamedText;
        phase = "done";
        weaveComplete = true;
        setTimeout(() => { weaveComplete = false; }, 1000);
        try { await navigator.clipboard.writeText(streamedText); copied = true; } catch {}
      }
    } catch (e) {
      error = friendlyError(e);
      phase = "idle";
    }
  }

  async function handleCompare() {
    if (!output || isGenerating) return;
    if (isFree()) {
      showCompareLock = true;
      setTimeout(() => { showCompareLock = false; }, 3000);
      return;
    }

    isGenerating = true;
    error = "";

    try {
      comparison = await generateComparison({
        prompt: prompt.trim(),
        format,
        context: contextText || undefined,
        attachments: attachedFiles.length > 0 ? attachedFiles.map((f) => f.content) : undefined,
      });
      compareMode = true;
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

  // Build HTML with highlighted fix spans. Escapes text and wraps spans in glow marks.
  function buildHighlightedHtml(text: string, spans: FixSpan[]): string {
    if (!spans.length) return escapeHtml(text);
    const sorted = [...spans].sort((a, b) => a.start - b.start);
    let html = "";
    let cursor = 0;
    for (const span of sorted) {
      if (span.start > cursor) html += escapeHtml(text.slice(cursor, span.start));
      html += `<span class="rhythm-fix glow">${escapeHtml(text.slice(span.start, span.end))}</span>`;
      cursor = span.end;
    }
    if (cursor < text.length) html += escapeHtml(text.slice(cursor));
    return html;
  }

  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Fade highlights after 3s, then switch to editable textarea
  $effect(() => {
    if (phase === "done" && fixSpans.length > 0 && cleanedText) {
      const timer = setTimeout(() => {
        fixSpans = [];
      }, 3000);
      return () => clearTimeout(timer);
    }
  });
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
  <!-- Toolbar -->
  <div class="flex items-center gap-2 px-4 pt-4 pb-3 shrink-0">
    <span class="font-heading italic text-[18px] mr-auto">Weave</span>

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
      class="inline-flex items-center gap-1.5 bg-surface border border-border rounded-lg px-3 py-1.5 text-xs text-muted hover:text-foreground hover:border-secondary transition-colors cursor-pointer"
      title="Attach a file"
      disabled={attachedFiles.length >= 3}
    >
      <svg class="w-[13px] h-[13px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
      Attach{#if attachedFiles.length > 0} ({attachedFiles.length}/3){/if}
    </button>

    <button
      onclick={() => { mode = mode === "generate" ? "adapt" : "generate"; }}
      class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors cursor-pointer rounded-lg
        {mode === 'adapt'
          ? 'bg-[var(--color-primary-muted)] text-foreground border border-[rgba(90,154,194,0.15)]'
          : 'bg-surface text-muted border border-border hover:border-secondary hover:text-foreground'}"
      title={mode === "adapt" ? "Adapts existing text to your voice" : "Switch to adapt mode: restyle existing text in your voice"}
    >
      <svg class="w-[13px] h-[13px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.85 0 114 4L7.5 20.5 2 22l1.5-5.5z"/></svg>
      Adapt
    </button>

    {#if hasProfile}
      <button class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-accent-wash border border-accent text-accent rounded-lg cursor-default">
        <div class="voice-badge-dot"></div>
        Voice
      </button>
    {/if}
  </div>

  <!-- No profile nudge -->
  {#if !hasProfile}
    <div class="flex items-center gap-2 mx-4 mb-3 p-2 bg-tint border border-secondary/20 rounded-lg">
      <p class="flex-1 text-[10px] text-muted leading-relaxed">
        No voice profile yet, output won't carry your voice.
        <button
          onclick={() => window.open("https://usenoren.ai", "_blank")}
          class="text-secondary font-medium cursor-pointer hover:text-foreground"
        >Upgrade to Pro</button> for AI extraction.
      </p>
    </div>
  {/if}

  <!-- Output area -->
  <div class="flex-1 min-h-0 overflow-y-auto px-4">
    {#if phase === "idle" && !comparison && !output}
      <div class="h-full flex flex-col items-center justify-center gap-5">
        <img src={loomIdleUrl} alt="" class="w-[130px] opacity-50" />
        <div class="flex flex-col items-center gap-1.5">
          <p class="text-display text-foreground/75">Ready to weave</p>
          <p class="text-xs text-muted">Your voice is loaded and ready</p>
        </div>
      </div>

    {:else if phase === "streaming" || phase === "polishing"}
      <div class="flex flex-col gap-2 h-full">
        <div class="flex items-center gap-2">
          <span class="font-heading italic text-[11px] text-muted tracking-wide">{format}</span>
          <span class="flex items-center gap-1.5 ml-auto">
            <span class="stream-status-dot {phase === 'polishing' ? 'polishing' : 'generating'}"></span>
            <span class="font-mono text-[10px] {phase === 'polishing' ? 'text-accent' : 'text-muted'}">
              {phase === "polishing" ? "Polishing voice" : "Generating"}
            </span>
          </span>
        </div>

        <div class="flex-1 overflow-y-auto output-card output-weave-bg min-h-0 relative">
          <!-- Progress thread -->
          <div class="stream-progress">
            <div class="stream-progress-fill {phase === 'polishing' ? 'complete' : ''}" style="width: {phase === 'polishing' ? '100' : Math.min(98, streamedText.length / 20)}%"></div>
          </div>

          {#if phase === "polishing"}
            <div class="polish-overlay visible">
              <div class="polish-pill">
                <div class="polish-spinner"></div>
                <span class="text-[12px] font-medium text-accent">Polishing voice</span>
              </div>
            </div>
          {/if}

          <div
            class="w-full p-4 font-heading italic text-[15px] whitespace-pre-wrap selectable {phase === 'polishing' ? 'stream-text-dim' : ''}"
            style="line-height:1.85;letter-spacing:-0.2px;color:var(--color-muted)"
          >{streamedText}{#if phase === "streaming"}<span class="stream-cursor"></span>{/if}</div>
        </div>

        <div class="flex items-center pb-2">
          <span class="font-mono text-[9px] text-muted">
            {streamTokens.input + streamTokens.output > 0 ? `${streamTokens.input + streamTokens.output} tokens` : ""}
          </span>
        </div>
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
            <div class="flex-1 p-4 bg-surface border border-border rounded-lg overflow-y-auto opacity-75">
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
              aria-label={copied ? "Copied" : "Copy voiced"}
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
      <div class="flex flex-col gap-2 h-full {cleanedText ? '' : 'animate-fabric-unfurl'}">
        <div class="flex items-center gap-2">
          <span class="font-heading italic text-[11px] text-muted tracking-wide">{format}</span>
          {#if cleanupStats && cleanupStats.fixed > 0}
            <span class="font-mono text-[9px] text-accent">{cleanupStats.fixed} rhythm fixes</span>
          {/if}
        </div>

        <div class="flex-1 overflow-y-auto output-card output-weave-bg min-h-0">
          {#if fixSpans.length > 0 && cleanedText}
            <!-- Show highlighted text briefly, then switch to textarea -->
            <div
              class="w-full p-4 font-heading italic text-[15px] text-foreground whitespace-pre-wrap selectable animate-text-weave"
              style="line-height:1.85;letter-spacing:-0.2px"
            >{@html buildHighlightedHtml(cleanedText, fixSpans)}</div>
          {:else}
            <textarea
              bind:value={editedText}
              class="w-full h-full p-4 font-heading italic text-[15px] text-foreground bg-transparent resize-none border-none focus:outline-none selectable {cleanedText ? '' : 'animate-text-weave'}"
              style="line-height:1.85;letter-spacing:-0.2px"
            ></textarea>
          {/if}
        </div>

        <div class="flex items-center pb-2">
          <div class="flex items-center gap-2">
            <span class="font-mono text-[9px] text-muted">
              {output.input_tokens + output.output_tokens} tokens
            </span>
            {#if editedText !== output.text}
              <span class="text-[9px] text-secondary font-medium">edited</span>
            {/if}
          </div>

          <div class="flex items-center gap-2 ml-auto">
            <!-- Compare link -->
            <div class="relative">
              <button
                onclick={handleCompare}
                class="inline-flex items-center gap-1 text-[10px] text-muted hover:text-secondary transition-colors cursor-pointer"
                title="Compare with and without your voice"
                disabled={isGenerating}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>
                Compare
                {#if isFree()}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-secondary opacity-60"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                {/if}
              </button>
              {#if showCompareLock}
                <div class="absolute bottom-full mb-1 right-0 z-10 p-2 bg-tint border border-secondary/20 rounded-xl whitespace-nowrap animate-fade-in-up" style="box-shadow: var(--shadow-dropdown)">
                  <p class="text-[10px] text-muted">Compare is a <span class="text-secondary font-medium">Pro</span> feature.</p>
                  <button
                    onclick={async () => { try { const r = await createCheckout("pro"); if (r.checkout_url !== "dev://granted") window.open(r.checkout_url, "_blank"); } catch {} }}
                    class="mt-1 text-[10px] text-secondary font-medium cursor-pointer hover:text-foreground uppercase tracking-wide"
                  >Upgrade</button>
                </div>
              {/if}
            </div>

            <button
              onclick={handleCopy}
              class="w-8 h-8 flex items-center justify-center border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
              title={copied ? "Copied" : "Copy"}
              aria-label={copied ? "Copied" : "Copy"}
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

  <!-- Input bar -->
  <div class="shrink-0 border-t border-border px-4 py-3">
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
