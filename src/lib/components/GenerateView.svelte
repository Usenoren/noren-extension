<script lang="ts">
  import { generate, generateStream, generateComparison, listFormats, injectGeneratedText, getProfileOverview, createCheckout, logEdit, trackGenerationUsedDaily, getSettings, getSyncedGenerationManifest, getSyncedGeneration, type GenerateResult, type ComparisonResult, type FixSpan } from "$lib/api/noren";
  import { isFree, isPro } from "$lib/stores/subscription.svelte";
  import { friendlyError } from "$lib/utils/errors";
  import LoadingSpinner from "./LoadingSpinner.svelte";
  import loomIdleUrl from "../../assets/loom-idle.png";

  let { initialContext = "", oncontextused, onnavigate }: { initialContext?: string; oncontextused?: () => void; onnavigate?: (tab: string) => void } = $props();

  // --- History types ---
  interface HistoryEntry {
    id: string;
    timestamp: string;
    format: string;
    prompt: string;
    mode: string;
    text: string;
    token_count: number;
  }

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
  let savedPrompt = $state("");
  let savedContext = $state("");  // preserved for inject-replace after contextText is cleared
  let error = $state("");
  let attachedFiles = $state<{ name: string; content: string }[]>([]);
  let hasProfile = $state(true);
  let showCompareLock = $state(false);
  let showOverflow = $state(false);
  let fileInput: HTMLInputElement | undefined = $state();
  let history = $state<HistoryEntry[]>([]);
  let historySyncMessage = $state("");

  // --- Streaming state ---
  let phase = $state<"idle" | "streaming" | "polishing" | "done">("idle");
  let streamedText = $state("");
  let cleanedText = $state("");
  let fixSpans = $state<FixSpan[]>([]);
  let cleanupStats = $state<{ found: number; fixed: number } | null>(null);
  let streamTokens = $state({ input: 0, output: 0 });
  let streamAbortController = $state<AbortController | null>(null);
  let isGenerating = $derived(phase === "streaming" || phase === "polishing");

  // --- Inline refinement state ---
  let refineSelection = $state<{ start: number; end: number; text: string } | null>(null);
  let refineInput = $state("");
  let isRefining = $state(false);
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let refineInputEl: HTMLInputElement | undefined = $state();

  // --- History persistence ---
  const HISTORY_KEY = "noren:weave_history";
  const MAX_HISTORY = 20;
  const HISTORY_SYNC_MIN_INTERVAL_MS = 30_000;
  let lastHistorySyncAt = 0;
  let historySyncInFlight = false;

  function normalizeHistory(value: unknown): HistoryEntry[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is HistoryEntry => {
      if (!entry || typeof entry !== "object") return false;
      const candidate = entry as Partial<HistoryEntry>;
      return Boolean(candidate.id && candidate.timestamp && candidate.prompt !== undefined && candidate.text !== undefined);
    });
  }

  function notifyUsageRefresh() {
    window.dispatchEvent(new CustomEvent("noren:usage-refresh"));
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent("noren:usage-refresh"));
    }, 2000);
  }

  function markGenerationCompleted() {
    trackGenerationUsedDaily().catch(() => {});
  }

  function toggleCompareMode() {
    if (isFree()) {
      showCompareLock = true;
      setTimeout(() => { showCompareLock = false; }, 3000);
      return;
    }
    compareMode = !compareMode;
  }

  async function loadHistory() {
    try {
      const data = await chrome.storage.local.get(HISTORY_KEY);
      const localHistory = normalizeHistory(data[HISTORY_KEY]);
      history = localHistory;
      await syncServerHistory(localHistory);
    } catch { history = []; }
  }

  async function syncServerHistory(localHistory: HistoryEntry[]) {
    const settings = await getSettings();
    if (!settings.noren_pro_logged_in) return;
    if (historySyncInFlight) return;

    const now = Date.now();
    if (lastHistorySyncAt && now - lastHistorySyncAt < HISTORY_SYNC_MIN_INTERVAL_MS) {
      return;
    }

    try {
      historySyncInFlight = true;
      lastHistorySyncAt = now;
      const manifest = await getSyncedGenerationManifest();
      historySyncMessage = manifest.length === 0 ? "No server Weave history found." : "";
      const deletedIds = new Set(
        manifest.filter((entry) => entry.is_deleted).map((entry) => entry.generation_id)
      );
      const retainedLocal = localHistory.filter((entry) => !deletedIds.has(entry.id));
      const existingIds = new Set(retainedLocal.map((entry) => entry.id));
      const missingServerEntries = manifest
        .filter((entry) => !entry.is_deleted && !existingIds.has(entry.generation_id))
        .slice(0, MAX_HISTORY);

      const fetched = await Promise.all(
        missingServerEntries.map(async (entry) => {
          try {
            return await getSyncedGeneration(entry.generation_id);
          } catch {
            return null;
          }
        })
      );

      const remoteHistory: HistoryEntry[] = fetched
        .filter((entry) => entry && !entry.quick_action && entry.output)
        .map((entry) => ({
          id: entry!.generation_id,
          timestamp: entry!.created_at || entry!.updated_at,
          format: entry!.format || "general",
          prompt: entry!.prompt || "",
          mode: entry!.mode === "adapt" ? "adapt" : "generate",
          text: entry!.output,
          token_count: (entry!.input_tokens || 0) + (entry!.output_tokens || 0),
        }));

      const merged = [...remoteHistory, ...retainedLocal]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, MAX_HISTORY);

      history = merged;
      await chrome.storage.local.set({ [HISTORY_KEY]: merged });
    } catch (e) {
      console.warn("[Noren] Weave history sync failed", e);
      const message = e instanceof Error ? e.message : String(e);
      historySyncMessage = message ? `Could not sync server Weave history: ${message}` : "Could not sync server Weave history.";
      // Sync is best-effort. Local history should still work offline or for non-sync accounts.
    } finally {
      historySyncInFlight = false;
    }
  }

  async function saveToHistory(entry: HistoryEntry) {
    history = [entry, ...history.slice(0, MAX_HISTORY - 1)];
    try {
      await chrome.storage.local.set({ [HISTORY_KEY]: history });
    } catch {}
  }

  async function clearHistory() {
    history = [];
    try {
      await chrome.storage.local.remove(HISTORY_KEY);
    } catch {}
  }

  function loadFromHistory(entry: HistoryEntry) {
    savedPrompt = entry.prompt;
    format = entry.format;
    mode = entry.mode as "generate" | "adapt";
    output = { text: entry.text, input_tokens: entry.token_count, output_tokens: 0 };
    editedText = entry.text;
    phase = "done";
    comparison = null;
    compareMode = false;
  }

  function formatTimestamp(ts: string): string {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  async function loadProfileFormats() {
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
  }

  // --- Init ---
  $effect(() => {
    loadHistory();
    loadProfileFormats();

    const handleProfileRefresh = () => {
      loadProfileFormats();
    };
    const handleAuthRefresh = () => {
      loadProfileFormats();
      loadHistory();
    };
    const handleProfileStorageChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName === "local" && changes.voice_profile) {
        loadProfileFormats();
      }
    };
    window.addEventListener("noren:auth-changed", handleAuthRefresh);
    window.addEventListener("noren:profile-changed", handleProfileRefresh);
    window.addEventListener("focus", handleProfileRefresh);
    chrome.storage.onChanged.addListener(handleProfileStorageChange);

    return () => {
      window.removeEventListener("noren:auth-changed", handleAuthRefresh);
      window.removeEventListener("noren:profile-changed", handleProfileRefresh);
      window.removeEventListener("focus", handleProfileRefresh);
      chrome.storage.onChanged.removeListener(handleProfileStorageChange);
    };
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
    savedPrompt = prompt.trim();
    savedContext = contextText;
    const pendingGenerationId = crypto.randomUUID();
    prompt = "";
    oncontextused?.();
    comparison = null;
    streamedText = "";
    cleanedText = "";
    fixSpans = [];
    cleanupStats = null;
    streamTokens = { input: 0, output: 0 };
    refineSelection = null;
    refineInput = "";
    isRefining = false;

    // Compare mode: non-streaming (comparison needs two results)
    if (compareMode) {
      phase = "streaming";
      try {
        const attachmentContents = attachedFiles.length > 0
          ? attachedFiles.map((f) => f.content)
          : undefined;
        comparison = await generateComparison({
          prompt: savedPrompt,
          format,
          context: contextText || undefined,
          attachments: attachmentContents,
        });
        output = comparison.with_voice;
        editedText = output.text;
        markGenerationCompleted();
        notifyUsageRefresh();
        saveToHistory({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), format, prompt: savedPrompt, mode, text: output.text, token_count: output.input_tokens + output.output_tokens });
      } catch (e) {
        error = friendlyError(e);
      } finally {
        phase = "done";
      }
      return;
    }

    // Streaming generation
    phase = "streaming";
    const abortController = new AbortController();
    streamAbortController = abortController;
    let cleanupTimeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const attachmentContents = attachedFiles.length > 0
        ? attachedFiles.map((f) => f.content)
        : undefined;

      for await (const event of generateStream({
        prompt: savedPrompt,
        format,
        level,
        mode: mode !== "generate" ? mode : undefined,
        context: contextText || undefined,
        attachments: attachmentContents,
        generationId: pendingGenerationId,
        signal: abortController.signal,
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
              markGenerationCompleted();
              notifyUsageRefresh();
              weaveComplete = true;
              setTimeout(() => { weaveComplete = false; }, 1000);
              saveToHistory({ id: pendingGenerationId, timestamp: new Date().toISOString(), format, prompt: savedPrompt, mode, text: streamedText, token_count: streamTokens.input + streamTokens.output });
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
          markGenerationCompleted();
          notifyUsageRefresh();
          weaveComplete = true;
          setTimeout(() => { weaveComplete = false; }, 1000);
          saveToHistory({ id: pendingGenerationId, timestamp: new Date().toISOString(), format, prompt: savedPrompt, mode, text: event.content, token_count: streamTokens.input + streamTokens.output });
          // Auto-copy
          try { await navigator.clipboard.writeText(event.content); copied = true; } catch {}
        } else if (event.type === "error") {
          error = friendlyError(event.message);
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
        markGenerationCompleted();
        notifyUsageRefresh();
        weaveComplete = true;
        setTimeout(() => { weaveComplete = false; }, 1000);
        saveToHistory({ id: pendingGenerationId, timestamp: new Date().toISOString(), format, prompt: savedPrompt, mode, text: streamedText, token_count: streamTokens.input + streamTokens.output });
        try { await navigator.clipboard.writeText(streamedText); copied = true; } catch {}
      }
    } catch (e) {
      error = friendlyError(e);
      phase = "idle";
    } finally {
      streamAbortController = null;
    }
  }

  function handleCancelGeneration() {
    streamAbortController?.abort("User cancelled");
    streamAbortController = null;
    if (streamedText) {
      output = { text: streamedText, input_tokens: streamTokens.input, output_tokens: streamTokens.output };
      editedText = streamedText;
      phase = "done";
    } else {
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
        prompt: savedPrompt || prompt.trim(),
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
      // If we had context text (user highlighted text before generating),
      // tell the content script to replace the original selection
      await injectGeneratedText(text, !!savedContext);
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

  // Close overflow menu on outside click
  function handleWindowClick(e: MouseEvent) {
    if (showOverflow) {
      const target = e.target as HTMLElement;
      if (!target.closest('.relative')) showOverflow = false;
    }
  }

  $effect(() => {
    if (showOverflow) {
      window.addEventListener('click', handleWindowClick, true);
      return () => window.removeEventListener('click', handleWindowClick, true);
    }
  });

  function handleNewWeave() {
    output = null;
    comparison = null;
    editedText = "";
    savedPrompt = "";
    savedContext = "";
    streamedText = "";
    cleanedText = "";
    fixSpans = [];
    cleanupStats = null;
    phase = "idle";
    compareMode = false;
    copied = false;
    error = "";
    refineSelection = null;
    refineInput = "";
    isRefining = false;
  }

  // --- Inline refinement handlers ---
  function handleOutputMouseUp() {
    if (!textareaEl) return;
    const start = textareaEl.selectionStart;
    const end = textareaEl.selectionEnd;
    if (start === end) {
      refineSelection = null;
      return;
    }
    refineSelection = { start, end, text: editedText.slice(start, end) };
    // Focus the refine input after a tick (bar needs to render first)
    setTimeout(() => refineInputEl?.focus(), 50);
  }

  function handleOutputKeyUp(e: KeyboardEvent) {
    if (e.shiftKey || e.metaKey || e.ctrlKey) handleOutputMouseUp();
  }

  async function handleRefine() {
    if (!refineSelection || !refineInput.trim() || isRefining) return;
    isRefining = true;
    error = "";

    try {
      const result = await generate({
        prompt: `${refineInput.trim()}\n\nReturn only the revised text.\n\n${refineSelection.text}`,
        format,
        level: "guided",
        mode: "adapt",
        context: editedText,
        quickAction: "rewrite",
      });

      const before = editedText.substring(0, refineSelection.start);
      const after = editedText.substring(refineSelection.end);
      editedText = before + result.text + after;
    } catch (e) {
      error = friendlyError(e);
    } finally {
      isRefining = false;
      refineSelection = null;
      refineInput = "";
    }
  }

  function dismissRefine() {
    refineSelection = null;
    refineInput = "";
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
    <span class="font-heading italic text-[18px]">Weave</span>

    {#if output || comparison}
      <button
        onclick={handleNewWeave}
        class="inline-flex items-center gap-1 px-2 py-1 text-[10px] text-muted hover:text-foreground bg-surface border border-border rounded-md transition-colors cursor-pointer"
        title="Start a new weave"
      >
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        New
      </button>
    {/if}

    <span class="mr-auto"></span>

    <select
      data-tour="format"
      bind:value={format}
      class="px-2 py-1 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
    >
      {#each formats as fmt}
        <option value={fmt}>{fmt}</option>
      {/each}
    </select>

    <button
      data-tour="adapt"
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

    <!-- Overflow menu -->
    <div class="relative">
      <button
        onclick={() => { showOverflow = !showOverflow; }}
        class="flex items-center justify-center w-7 h-7 text-muted hover:text-foreground bg-surface border border-border rounded-md transition-colors cursor-pointer text-sm"
        title="More options"
      >···</button>
      {#if showOverflow}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="absolute right-0 top-full mt-1 z-10 bg-surface border border-border rounded-lg shadow-lg py-1 min-w-[140px]" style="box-shadow: 0 4px 16px rgba(30,49,72,0.12)">
          <button
            onclick={() => { handleAttachFile(); showOverflow = false; }}
            class="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-tint transition-colors cursor-pointer text-left"
            disabled={attachedFiles.length >= 3}
          >
            <svg class="w-3.5 h-3.5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
            Attach file{#if attachedFiles.length > 0} ({attachedFiles.length}/3){/if}
          </button>
          <button
            onclick={() => { toggleCompareMode(); showOverflow = false; }}
            class="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-tint transition-colors cursor-pointer text-left"
          >
            <svg class="w-3.5 h-3.5 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>
            Compare mode{#if compareMode} on{/if}
          </button>
        </div>
      {/if}
    </div>
  </div>

  {#if compareMode && !comparison}
    <div class="mx-4 mb-3 flex items-center gap-2 rounded-lg border border-secondary/20 bg-tint px-3 py-2">
      <span class="text-[10px] text-secondary font-medium">Compare mode</span>
      <span class="text-[10px] text-muted">Next weave will generate with and without your voice.</span>
      <button
        onclick={() => { compareMode = false; }}
        class="ml-auto text-[10px] text-muted hover:text-foreground cursor-pointer"
      >Turn off</button>
    </div>
  {/if}

  <div class="divider shrink-0"></div>

  <!-- No profile nudge -->
  {#if !hasProfile}
    <div class="mx-4 mb-3 p-3.5 bg-tint border border-secondary/20 rounded-xl">
      <div class="flex items-start gap-2.5 mb-2.5">
        <div class="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-surface border border-border" style="margin-top:1px">
          <svg class="w-[13px] h-[13px] text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
        </div>
        <div>
          <p class="text-[11px] font-medium text-foreground">No voice profile</p>
          <p class="text-[10px] text-muted mt-0.5 leading-relaxed">Generation works, but output won't carry your voice.</p>
        </div>
      </div>
      {#if isPro()}
        <p class="text-[10px] text-muted leading-relaxed mb-2">Your profile will sync automatically after extraction in the desktop app or on <a href="https://usenoren.ai" target="_blank" class="text-secondary font-medium" style="text-decoration:none">usenoren.ai</a>.</p>
        <button
          onclick={() => onnavigate?.("profile")}
          class="text-[10px] text-secondary font-medium cursor-pointer hover:text-foreground"
        >Or write a quick description</button>
      {:else}
        <div class="flex flex-col gap-1.5">
          <button
            onclick={() => onnavigate?.("profile")}
            class="w-full text-left p-2 bg-surface border border-border rounded-lg hover:border-secondary transition-colors cursor-pointer"
          >
            <span class="text-[11px] font-medium text-foreground">Write a quick voice description</span>
            <span class="text-[9px] text-muted block mt-px">Takes 2 minutes. Noren uses it to match your tone.</span>
          </button>
          <button
            onclick={() => window.open("https://usenoren.ai", "_blank")}
            class="w-full text-left p-2 bg-surface border border-border rounded-lg hover:border-secondary transition-colors cursor-pointer"
          >
            <span class="text-[11px] font-medium text-secondary">Upgrade to Pro</span>
            <span class="text-[9px] text-muted block mt-px">Get AI extraction and automatic profile sync.</span>
          </button>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Output area -->
  <div class="flex-1 min-h-0 overflow-y-auto px-4">
    {#if phase === "idle" && !comparison && !output}
      <div class="h-full flex flex-col items-center {history.length > 0 ? 'justify-start pt-8' : 'justify-center'} gap-5">
        <img src={loomIdleUrl} alt="" class="w-[100px] loom-idle-img" />
        <div class="flex flex-col items-center gap-1.5">
          <p class="text-display text-foreground/75">Ready to weave</p>
          <p class="text-xs text-muted">{hasProfile ? (history.length > 0 ? "Type below, or pick up where you left off" : "Your voice is loaded and ready") : "Your voice is loaded and ready"}</p>
        </div>

        {#if history.length > 0}
          <div class="history-section">
            <div class="history-header">
              <span class="history-label">Recent</span>
              <button
                onclick={clearHistory}
                class="history-clear"
              >Clear history</button>
            </div>
            <div class="gen-list">
              {#each history as entry, i}
                <button
                  onclick={() => loadFromHistory(entry)}
                  class="gen-item"
                  class:latest={i === 0}
                >
                  <div class="gen-item-content">
                    <div class="gen-item-prompt">{entry.prompt}</div>
                    <div class="gen-item-meta">
                      <span class="gen-item-format">{entry.format}</span>
                      <span class="gen-item-dot">&middot;</span>
                      <span class="gen-item-time">{formatTimestamp(entry.timestamp)}</span>
                      <span class="gen-item-dot">&middot;</span>
                      <span class="gen-item-tokens">{entry.token_count.toLocaleString()} tokens</span>
                    </div>
                  </div>
                </button>
              {/each}
            </div>
          </div>
        {:else if historySyncMessage}
          <p class="text-[10px] text-muted/70">{historySyncMessage}</p>
        {/if}
      </div>

    {:else if phase === "streaming" || phase === "polishing"}
      <div class="flex flex-col gap-2 h-full">
        {#if savedPrompt}
          <div class="text-[11px] text-muted leading-relaxed px-1 py-1.5 truncate" title={savedPrompt}>{savedPrompt}</div>
        {/if}
        <div class="flex items-center gap-2">
          <span class="font-heading italic text-[11px] text-muted tracking-wide">{format}</span>
          <span class="flex items-center gap-1.5 ml-auto">
            <span class="stream-status-dot {phase === 'polishing' ? 'polishing' : 'generating'}"></span>
            <span class="font-mono text-[10px] {phase === 'polishing' ? 'text-accent' : 'text-muted'}">
              {phase === "polishing" ? "Polishing voice" : "Generating"}
            </span>
            <button class="stop-btn" onclick={handleCancelGeneration}>Stop</button>
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
        {#if savedPrompt}
          <div class="text-[11px] text-muted leading-relaxed px-1 py-1.5 truncate" title={savedPrompt}>{savedPrompt}</div>
        {/if}
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
              bind:this={textareaEl}
              bind:value={editedText}
              onmouseup={handleOutputMouseUp}
              onkeyup={handleOutputKeyUp}
              class="w-full h-full p-4 font-heading italic text-[15px] text-foreground bg-transparent resize-none border-none focus:outline-none selectable {cleanedText ? '' : 'animate-text-weave'}"
              style="line-height:1.85;letter-spacing:-0.2px"
            ></textarea>
          {/if}
        </div>

        {#if refineSelection}
          <div class="refine-bar">
            <svg class="w-3.5 h-3.5 shrink-0 text-accent opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Z"/></svg>
            <input
              bind:this={refineInputEl}
              bind:value={refineInput}
              onkeydown={(e) => { if (e.key === "Enter") handleRefine(); if (e.key === "Escape") dismissRefine(); }}
              placeholder="Refine selection..."
              disabled={isRefining}
              class="flex-1 min-w-0 bg-transparent border-none text-[11px] text-foreground outline-none placeholder:text-muted placeholder:italic"
            />
            {#if isRefining}
              <div class="refine-spinner"></div>
            {:else}
              <button onclick={handleRefine} class="refine-submit" title="Refine">
                <svg class="w-[11px] h-[11px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75"/></svg>
              </button>
            {/if}
            <button onclick={dismissRefine} class="refine-dismiss" title="Dismiss">
              <svg class="w-[10px] h-[10px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        {/if}

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
        data-tour="input"
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

<style>
  .history-section {
    width: 100%;
    margin-top: 8px;
    animation: history-fade-up 500ms 150ms cubic-bezier(0.16, 1, 0.3, 1) both;
  }

  @keyframes history-fade-up {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
    padding: 0 2px;
  }

  .history-label {
    font-family: "JetBrains Mono", monospace;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--color-muted);
    opacity: 0.6;
  }

  .history-clear {
    font-family: inherit;
    font-size: 10px;
    color: var(--color-muted);
    background: none;
    border: none;
    cursor: pointer;
    opacity: 0;
    transition: opacity 200ms ease, color 200ms ease;
    padding: 2px 6px;
    border-radius: 4px;
  }

  .history-section:hover .history-clear { opacity: 0.5; }
  .history-clear:hover { opacity: 1; color: var(--color-accent); }

  .gen-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .gen-item {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    width: 100%;
    padding: 12px 14px;
    border-radius: 8px;
    border: none;
    border-left: 2px solid transparent;
    background: none;
    color: var(--color-foreground);
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    transition: all 150ms ease;
    position: relative;
  }

  .gen-item:hover { background: rgba(255, 255, 255, 0.03); }
  .gen-item.latest { border-left-color: var(--color-accent); }

  .gen-item.latest::before {
    content: "";
    position: absolute;
    inset: 0;
    width: 100%;
    background: linear-gradient(90deg, rgba(122, 51, 64, 0.1), transparent 60%);
    border-radius: 8px;
    pointer-events: none;
  }

  .gen-item-content {
    flex: 1;
    min-width: 0;
    position: relative;
  }

  .gen-item-prompt {
    margin-bottom: 6px;
    color: var(--color-foreground);
    font-size: 12px;
    font-style: italic;
    line-height: 1.5;
    opacity: 0.85;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
  }

  .gen-item:hover .gen-item-prompt { opacity: 1; }

  .gen-item-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .gen-item-format {
    flex-shrink: 0;
    padding: 2px 7px;
    border-radius: 4px;
    border: 1px solid rgba(122, 51, 64, 0.12);
    background: rgba(122, 51, 64, 0.08);
    color: var(--color-accent);
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .gen-item-time,
  .gen-item-tokens {
    color: var(--color-muted);
    font-size: 9px;
    white-space: nowrap;
  }

  .gen-item-time { opacity: 0.7; }
  .gen-item-tokens { opacity: 0.5; }
  .gen-item-dot { color: var(--color-muted); opacity: 0.3; font-size: 8px; }
</style>
