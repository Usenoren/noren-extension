<script lang="ts">
  import {
    readProfileContent,
    saveProfileEdit,
    getProfileOverview,
    getProfileMetadata,
    getEditLogCount,
    uploadEditLog,
    refreshLivingProfile,
    getRefreshHistory,
    rollbackProfile,
    syncProfileUp,
    syncProfileDown,
    getSyncStatus,
    createCheckout,
    guidedProfileEdit,
    getSettings,
    type ProfileContent,
    type ProfileOverview,
    type ProfileMetadata,
    type RefreshHistoryEntry,
    type SyncStatus,
    type GuidedEditResponse,
  } from "$lib/api/noren";
  import {
    canExtract,
    canExport,
    canLivingProfile,
    canSync,
    isPro,
    refresh as refreshSubscription,
  } from "$lib/stores/subscription.svelte";
  import { friendlyError } from "$lib/utils/errors";
  import LoadingSpinner from "./LoadingSpinner.svelte";
  import loomIdleUrl from "../../assets/loom-idle.png";

  // --- State ---
  let overview = $state<ProfileOverview | null>(null);
  let profile = $state<ProfileContent | null>(null);
  let isLoading = $state(true);
  let error = $state("");
  let saveSuccess = $state(false);

  // Server profile state
  let metadata = $state<ProfileMetadata | null>(null);
  let editCount = $state(0);
  let refreshHistory = $state<RefreshHistoryEntry[]>([]);
  let syncStatus = $state<SyncStatus | null>(null);
  let isRefreshing = $state(false);
  let isRollingBack = $state(false);
  let isSyncing = $state(false);
  let isExporting = $state(false);
  let refreshMessage = $state("");
  let showHistory = $state(false);

  // Guided editing
  let guidedInstruction = $state("");
  let guidedFormat = $state<string | undefined>(undefined);
  let isGuidedEditing = $state(false);
  let guidedResult = $state<GuidedEditResponse | null>(null);
  let guidedError = $state("");
  let showGuidedDiff = $state(false);

  // Tabs: "core" or format name
  let activeTab = $state("core");

  // Editing
  let isEditing = $state(false);
  let editContent = $state("");

  // For new profiles
  let isCreating = $state(false);
  let createContent = $state("");

  let displayContent = $derived(
    activeTab === "core"
      ? profile?.core_identity || ""
      : profile?.contexts[activeTab] || ""
  );

  // --- Init ---
  $effect(() => {
    loadProfile();
  });

  async function loadProfile() {
    isLoading = true;
    error = "";
    try {
      overview = await getProfileOverview();
      if (overview.exists && !overview.is_server) {
        profile = await readProfileContent();
      }
      await refreshSubscription();

      // Load server-specific data
      if (overview?.is_server) {
        const [meta, edits] = await Promise.all([
          getProfileMetadata().catch(() => null),
          getEditLogCount(),
        ]);
        metadata = meta;
        editCount = edits;

        if (canSync()) {
          syncStatus = await getSyncStatus().catch(() => null);
        }
        if (canLivingProfile()) {
          refreshHistory = await getRefreshHistory(10).catch(() => []);
        }
      }
    } catch (e) {
      error = friendlyError(e);
    } finally {
      isLoading = false;
    }
  }

  // --- Actions ---

  function handleEdit() {
    editContent = displayContent;
    isEditing = true;
  }

  function handleCancelEdit() {
    isEditing = false;
    editContent = "";
  }

  async function handleSave() {
    error = "";
    try {
      if (activeTab === "core") {
        await saveProfileEdit({ coreIdentity: editContent });
      } else {
        await saveProfileEdit({
          coreIdentity: profile?.core_identity || "",
          contextFormat: activeTab,
          contextContent: editContent,
        });
      }
      isEditing = false;
      saveSuccess = true;
      setTimeout(() => { saveSuccess = false; }, 2000);
      await loadProfile();
    } catch (e) {
      error = friendlyError(e);
    }
  }

  async function handleCreate() {
    error = "";
    if (!createContent.trim()) {
      error = "Write a description of your voice first.";
      return;
    }
    try {
      await saveProfileEdit({ coreIdentity: createContent.trim() });
      isCreating = false;
      createContent = "";
      saveSuccess = true;
      setTimeout(() => { saveSuccess = false; }, 2000);
      await loadProfile();
    } catch (e) {
      error = friendlyError(e);
    }
  }

  function switchTab(tab: string) {
    activeTab = tab;
    isEditing = false;
    editContent = "";
  }

  async function handleUpgrade(target: string) {
    error = "";
    try {
      const result = await createCheckout(target);
      window.open(result.checkout_url, "_blank");
    } catch (e) {
      error = friendlyError(e);
    }
  }

  // --- Living Profile Actions ---

  function isRefreshDisabled(): boolean {
    if (!metadata?.next_refresh_available) return false;
    return new Date(metadata.next_refresh_available) > new Date();
  }

  function refreshCountdown(): string {
    if (!metadata?.next_refresh_available) return "";
    const diff = new Date(metadata.next_refresh_available).getTime() - Date.now();
    if (diff <= 0) return "";
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  async function handleUploadAndRefresh() {
    isRefreshing = true;
    error = "";
    refreshMessage = "";
    try {
      await uploadEditLog();
      const result = await refreshLivingProfile();
      refreshMessage = `${result.message} (${result.sections_updated} section${result.sections_updated !== 1 ? "s" : ""} updated)`;
      editCount = 0;
      await loadProfile();
    } catch (e) {
      error = friendlyError(e);
    } finally {
      isRefreshing = false;
    }
  }

  async function handleRollback() {
    isRollingBack = true;
    error = "";
    try {
      await rollbackProfile();
      await loadProfile();
    } catch (e) {
      error = friendlyError(e);
    } finally {
      isRollingBack = false;
    }
  }

  async function handleSyncUp() {
    isSyncing = true;
    error = "";
    try {
      await syncProfileUp();
      syncStatus = await getSyncStatus().catch(() => null);
    } catch (e) {
      error = friendlyError(e);
    } finally {
      isSyncing = false;
    }
  }

  async function handleSyncDown() {
    isSyncing = true;
    error = "";
    try {
      await syncProfileDown();
      syncStatus = await getSyncStatus().catch(() => null);
    } catch (e) {
      error = friendlyError(e);
    } finally {
      isSyncing = false;
    }
  }

  async function handleGuidedEdit() {
    if (!guidedInstruction.trim()) return;
    guidedError = "";
    guidedResult = null;
    showGuidedDiff = false;
    isGuidedEditing = true;
    try {
      const result = await guidedProfileEdit({
        instruction: guidedInstruction.trim(),
        format: guidedFormat,
      });
      guidedResult = result;
      if (result.edited) {
        guidedInstruction = "";
        await loadProfile();
      }
    } catch (e) {
      guidedError = friendlyError(e);
    } finally {
      isGuidedEditing = false;
    }
  }

  async function handleExport() {
    isExporting = true;
    error = "";
    try {
      const content = await readProfileContent();
      const blob = new Blob([JSON.stringify(content, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "noren-voice-profile.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      error = friendlyError(e);
    } finally {
      isExporting = false;
    }
  }

  // Add new format context
  let showAddFormat = $state(false);
  let newFormatName = $state("");

  function handleAddFormat() {
    const name = newFormatName.trim().toLowerCase();
    if (!name) return;
    if (profile?.contexts[name] !== undefined) {
      error = `Format "${name}" already exists`;
      return;
    }
    newFormatName = "";
    showAddFormat = false;
    activeTab = name;
    editContent = "";
    isEditing = true;
  }
</script>

{#snippet dimBar(label: string, pct: number, value: string, lowLabel: string, highLabel: string)}
  <div class="pv-dim-row">
    <div class="pv-dim-header">
      <span class="pv-dim-label">{label}</span>
      <span class="pv-dim-value">{value}</span>
    </div>
    <div class="pv-dim-track">
      <div class="pv-dim-indicator" style="left: {pct}%"></div>
    </div>
    <div class="pv-dim-ends">
      <span class="pv-dim-end">{lowLabel}</span>
      <span class="pv-dim-end">{highLabel}</span>
    </div>
  </div>
{/snippet}

<div class="flex flex-col h-full animate-fade-in-up">
  {#if isLoading}
    <div class="flex items-center justify-center h-full">
      <LoadingSpinner />
    </div>
  {:else if !overview?.exists && !isCreating}
    <!-- No profile — creation prompt -->
    <div class="flex flex-col h-full">
      <div class="flex-1 flex flex-col items-center justify-center gap-4 px-6">
        <div class="text-center">
          <img src={loomIdleUrl} alt="" class="w-[100px] mx-auto mb-3 loom-idle-img" />
          <h3 class="text-sm font-medium text-foreground">Create Your Voice Profile</h3>
          <p class="text-[11px] text-muted mt-1.5 leading-relaxed max-w-[280px]">
            Describe how you write — your tone, style, patterns. Noren uses this to make every generation sound like you.
          </p>
        </div>

        <button
          onclick={() => { isCreating = true; }}
          class="px-4 py-2 text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer rounded-md"
        >
          Write My Profile
        </button>
      </div>

      <!-- AI Extraction nudge -->
      <div class="mx-4 mb-4 p-3 bg-tint border border-secondary/20 rounded-xl">
        <p class="text-[10px] text-muted leading-relaxed">
          <span class="text-secondary font-medium">Don't want to write it yourself?</span> AI Extraction analyzes your real writing — sentence patterns, vocabulary, rhetorical style — and builds your profile automatically.
        </p>
        <div class="flex gap-2 items-center mt-2">
          {#if canExtract()}
            <span class="text-[10px] text-secondary font-medium">Available in the desktop app</span>
          {:else}
            <button
              onclick={() => handleUpgrade("extraction")}
              class="text-[10px] text-secondary font-medium cursor-pointer hover:text-foreground uppercase tracking-wide"
            >
              One-time $19
            </button>
            <span class="text-[10px] text-muted">or</span>
            <button
              onclick={() => handleUpgrade("pro")}
              class="text-[10px] text-secondary font-medium cursor-pointer hover:text-foreground uppercase tracking-wide"
            >
              Included with Pro
            </button>
          {/if}
        </div>
      </div>
    </div>
  {:else if isCreating}
    <!-- Creation form -->
    <div class="flex flex-col h-full px-4 py-4 gap-3">
      <div>
        <h3 class="text-xs font-medium text-foreground">Describe Your Voice</h3>
        <p class="text-[10px] text-muted mt-0.5">How do you write? What makes your style yours?</p>
      </div>

      <textarea
        bind:value={createContent}
        class="flex-1 p-3 text-xs leading-relaxed border border-border bg-surface text-foreground resize-none placeholder-muted rounded-md focus:outline-none focus:border-secondary"
        placeholder={"Example:\n\nI write casually and directly. Short sentences. I use contractions, avoid jargon, and get to the point fast. I'm opinionated but not aggressive — more like a friend giving honest advice. I occasionally use humor and rhetorical questions."}
      ></textarea>

      {#if error}
        <p class="text-[10px] text-error">{error}</p>
      {/if}

      <div class="flex items-center gap-2 shrink-0">
        <button
          onclick={() => { isCreating = false; createContent = ""; error = ""; }}
          class="px-3 py-1.5 text-xs border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
        >
          Cancel
        </button>
        <button
          onclick={handleCreate}
          class="px-3 py-1.5 text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer rounded-md"
        >
          Save Profile
        </button>
      </div>
    </div>
  {:else if overview?.is_server}
    <!-- Server profile -->
    {@const vo = overview.voice_overview}
    <div class="flex flex-col gap-3 h-full px-4 py-4 overflow-y-auto">

      <!-- Voice Snapshot -->
      {#if vo?.summary}
        <div class="p-3 card-hero">
          <span class="section-label">Voice snapshot</span>
          <p class="text-xs text-foreground leading-relaxed mt-2">{vo.summary}</p>
        </div>
      {:else}
        <div class="p-3 card-hero">
          <p class="text-sm font-medium text-foreground">Voice profile on Noren servers</p>
          <p class="text-[10px] text-muted mt-1 leading-relaxed">
            Your extracted profile is securely stored and used automatically when generating text.
          </p>
        </div>
      {/if}

      <!-- Voice Dimensions -->
      {#if vo?.routing}
        {@const routing = vo.routing}
        <div class="card-flat" style="padding: 12px 14px;">
          <span class="section-label">Voice dimensions</span>
          <div class="pv-dims">
            {@render dimBar("Structure", routing.structure_predictability === "high" ? 85 : routing.structure_predictability === "medium" ? 50 : 15, routing.structure_predictability, "varied", "predictable")}
            {@render dimBar("Register", routing.register_break_frequency * 10, `${routing.register_break_frequency} / 10`, "consistent", "shifting")}
            {@render dimBar("Formality", routing.casual_marker_density === "high" ? 85 : routing.casual_marker_density === "medium" ? 50 : 15, routing.casual_marker_density, "formal", "casual")}
            {@render dimBar("Phrasing", routing.signature_phrase_rigidity === "high" ? 85 : routing.signature_phrase_rigidity === "medium" ? 50 : 15, routing.signature_phrase_rigidity, "fluid", "fixed")}
          </div>
        </div>
      {/if}

      <!-- Pattern Depth -->
      {#if vo?.counts}
        {@const counts = vo.counts}
        <div class="card-flat" style="padding: 12px 14px;">
          <span class="section-label">Pattern depth</span>
          <div class="pv-depth">
            <div class="pv-depth-item"><span class="pv-depth-count">{counts.analogy_domains}</span><span class="pv-depth-name">analogy<br>families</span></div>
            <div class="pv-depth-item"><span class="pv-depth-count">{counts.micro_constructions}</span><span class="pv-depth-name">sentence<br>patterns</span></div>
            <div class="pv-depth-item"><span class="pv-depth-count">{counts.signature_phrases}</span><span class="pv-depth-name">signature<br>phrases</span></div>
            <div class="pv-depth-item"><span class="pv-depth-count">{counts.anti_patterns}</span><span class="pv-depth-name">anti-<br>patterns</span></div>
            {#if vo.corpus}
              <div class="pv-depth-item pv-depth-full">
                <span class="pv-depth-count" style="font-size: 14px;">{counts.profile_lines}</span>
                <span class="pv-depth-name">lines of voice DNA across {vo.corpus.unique_sample_count} samples</span>
              </div>
            {/if}
          </div>
        </div>
      {/if}

      <!-- Sentence Rhythm -->
      {#if vo?.baseline_rhythm}
        {@const rhythm = vo.baseline_rhythm}
        <div class="card-flat" style="padding: 12px 14px;">
          <span class="section-label">Sentence rhythm</span>
          <div style="margin-top: 8px;">
            <div class="pv-rhythm-bar">
              <div class="pv-rhythm-seg pv-rhythm-short" style="width: {rhythm.distributionPct.short}%"></div>
              <div class="pv-rhythm-seg pv-rhythm-medium" style="width: {rhythm.distributionPct.medium}%"></div>
              <div class="pv-rhythm-seg pv-rhythm-long" style="width: {rhythm.distributionPct.long}%"></div>
              <div class="pv-rhythm-seg pv-rhythm-vlong" style="width: {rhythm.distributionPct.veryLong}%"></div>
            </div>
            <div class="pv-rhythm-legend">
              <span class="pv-rhythm-legend-item"><span class="pv-rhythm-dot" style="background: var(--color-secondary)"></span>Short &lt;8w</span>
              <span class="pv-rhythm-legend-item"><span class="pv-rhythm-dot" style="background: var(--color-accent)"></span>Medium 8-15w</span>
              <span class="pv-rhythm-legend-item"><span class="pv-rhythm-dot" style="background: var(--color-warning)"></span>Long 16-25w</span>
              <span class="pv-rhythm-legend-item"><span class="pv-rhythm-dot" style="background: #C23B2A"></span>25w+</span>
            </div>
            <div class="pv-rhythm-stats">
              <div class="pv-rhythm-stat"><span class="pv-rhythm-stat-val">{Math.round(rhythm.medianWordCount)}</span><span class="pv-rhythm-stat-lbl">median words</span></div>
              <div class="pv-rhythm-stat"><span class="pv-rhythm-stat-val">{rhythm.sentenceCeiling}</span><span class="pv-rhythm-stat-lbl">ceiling</span></div>
              <div class="pv-rhythm-stat"><span class="pv-rhythm-stat-val">{rhythm.longToShortRatio.toFixed(1)}</span><span class="pv-rhythm-stat-lbl">L:S ratio</span></div>
              <div class="pv-rhythm-stat"><span class="pv-rhythm-stat-val">{rhythm.medianCommasPerSentence.toFixed(1)}</span><span class="pv-rhythm-stat-lbl">commas/sent</span></div>
            </div>
          </div>
        </div>
      {/if}

      <!-- Format Cards -->
      {#if overview.formats.length > 0}
        {@const FMT_COLORS: Record<string, string> = { general: "var(--color-primary)", blog: "var(--color-secondary)", twitter: "var(--color-accent)", email: "var(--color-signal)" }}
        <div class="card-flat" style="padding: 12px 14px;">
          <span class="section-label">Formats</span>
          <div class="pv-format-list">
            {#each overview.formats as fmt}
              {@const fmtRhythm = vo?.format_rhythms?.[fmt]}
              <div class="pv-format-row">
                <div class="pv-format-accent" style="background: {FMT_COLORS[fmt] || 'var(--color-primary)'}"></div>
                <span class="pv-format-name">{fmt}</span>
                {#if fmtRhythm}
                  <div class="pv-format-stats">
                    <span class="pv-format-stat"><strong>{Math.round(fmtRhythm.medianWordCount)}</strong> median</span>
                    <span class="pv-format-stat"><strong>{fmtRhythm.longToShortRatio.toFixed(1)}</strong> L:S</span>
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Guided Edit -->
      {#if isPro() && overview.voice_overview}
        <div class="ge-card">
          <span class="section-label">Refine your voice</span>
          <div class="ge-input-row">
            <input
              class="ge-input"
              bind:value={guidedInstruction}
              placeholder="e.g. Remove exclamation marks"
              disabled={isGuidedEditing}
              onkeydown={(e) => { if (e.key === "Enter") handleGuidedEdit(); }}
            />
            <button
              class="ge-submit"
              onclick={handleGuidedEdit}
              disabled={!guidedInstruction.trim() || isGuidedEditing}
            >
              {isGuidedEditing ? "..." : "Apply"}
            </button>
          </div>
          {#if overview.formats.length > 0}
            <div class="ge-format-row">
              <button class="ge-format-pill {guidedFormat === undefined ? 'active' : ''}" onclick={() => { guidedFormat = undefined; }}>Core</button>
              {#each overview.formats as fmt}
                <button class="ge-format-pill {guidedFormat === fmt ? 'active' : ''}" onclick={() => { guidedFormat = fmt; }}>{fmt}</button>
              {/each}
            </div>
          {/if}
          {#if isGuidedEditing}
            <div class="ge-loading">
              <LoadingSpinner />
              <span class="text-[11px] text-muted">Applying changes...</span>
            </div>
          {/if}
          {#if guidedResult}
            <div class="ge-result" class:ge-result-noop={!guidedResult.edited}>
              <span class="ge-result-msg" class:text-signal={guidedResult.edited} class:text-muted={!guidedResult.edited}>{guidedResult.message}</span>
              {#if guidedResult.edited}
                <button class="ge-result-toggle" onclick={() => { showGuidedDiff = !showGuidedDiff; }}>
                  {showGuidedDiff ? "Hide" : "Show"} changes
                </button>
                {#if showGuidedDiff}
                  <div class="ge-diff">
                    <span class="ge-diff-label">Before</span>
                    <pre class="ge-diff-block ge-diff-old">{guidedResult.original.slice(0, 300)}{guidedResult.original.length > 300 ? "..." : ""}</pre>
                    <span class="ge-diff-label">After</span>
                    <pre class="ge-diff-block ge-diff-new">{guidedResult.updated.slice(0, 300)}{guidedResult.updated.length > 300 ? "..." : ""}</pre>
                  </div>
                {/if}
              {/if}
            </div>
          {/if}
          {#if guidedError}
            <p class="text-[10px] text-error mt-2">{guidedError}</p>
          {/if}
        </div>
      {/if}

      <!-- Living Profile section -->
      {#if canLivingProfile()}
        <div class="p-3 bg-surface border border-border rounded-xl">
          <div class="flex items-center gap-1.5 mb-2">
            <div class="w-[5px] h-[5px] rounded-full bg-secondary animate-pulse"></div>
            <span class="text-subhead text-secondary">Living Profile</span>
            {#if editCount > 0}
              <span class="ml-auto px-1.5 py-0.5 text-[9px] bg-secondary/10 text-secondary rounded-full font-medium">{editCount} pending edit{editCount !== 1 ? "s" : ""}</span>
            {/if}
          </div>

          {#if refreshMessage}
            <p class="text-[10px] text-secondary mb-2">{refreshMessage}</p>
          {/if}

          <div class="flex items-center gap-2">
            <button
              onclick={handleUploadAndRefresh}
              disabled={isRefreshing || isRefreshDisabled()}
              class="px-3 py-1 text-[10px] font-medium transition-colors cursor-pointer rounded
                {isRefreshing || isRefreshDisabled()
                  ? 'bg-surface text-muted border border-border cursor-not-allowed opacity-50'
                  : 'bg-secondary text-white hover:bg-secondary/90'}"
            >
              {#if isRefreshing}
                <span class="inline-flex items-center gap-1"><LoadingSpinner /> Refreshing</span>
              {:else}
                Upload & Refresh
              {/if}
            </button>

            {#if metadata?.can_rollback}
              <button
                onclick={handleRollback}
                disabled={isRollingBack}
                class="px-3 py-1 text-[10px] border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded"
              >
                {isRollingBack ? "Rolling back..." : "Rollback"}
              </button>
            {/if}

            {#if isRefreshDisabled()}
              <span class="text-[9px] text-muted ml-auto">Available in {refreshCountdown()}</span>
            {/if}
          </div>

          <!-- Refresh history -->
          {#if refreshHistory.length > 0}
            <button
              onclick={() => { showHistory = !showHistory; }}
              class="mt-2 text-[10px] text-muted hover:text-secondary cursor-pointer"
            >
              {showHistory ? "Hide" : "Show"} history ({refreshHistory.length})
            </button>

            {#if showHistory}
              <div class="mt-2 flex flex-col gap-2">
                {#each refreshHistory as entry}
                  <div class="p-2 bg-tint border border-border rounded text-[10px]">
                    <div class="flex items-center gap-2 mb-1">
                      <span class="text-muted">{new Date(entry.created_at).toLocaleDateString()}</span>
                      <span class="text-secondary font-medium">{entry.sections_updated} section{entry.sections_updated !== 1 ? "s" : ""}</span>
                      {#if entry.rolled_back}
                        <span class="px-1 py-0.5 text-[8px] bg-error/10 text-error rounded">rolled back</span>
                      {/if}
                    </div>
                    {#if entry.observations.length > 0}
                      <ul class="text-muted leading-relaxed ml-2">
                        {#each entry.observations as obs}
                          <li>{obs}</li>
                        {/each}
                      </ul>
                    {/if}
                    {#each entry.diffs as diff}
                      <div class="mt-1 p-1.5 bg-surface rounded">
                        <span class="text-[9px] text-secondary font-medium uppercase">{diff.section}</span>
                      </div>
                    {/each}
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
      {:else}
        <div class="p-2.5 bg-tint border border-secondary/10 rounded-xl">
          <p class="text-subhead text-secondary">Living Profile</p>
          <p class="text-[10px] text-muted leading-relaxed mt-0.5">
            Your profile evolves as you write. Noren tracks your edits and suggests refinements automatically.
          </p>
          <button
            onclick={() => handleUpgrade("pro")}
            class="mt-2 px-3 py-1 text-[10px] font-medium bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer rounded uppercase tracking-wide"
          >
            Upgrade to Pro
          </button>
        </div>
      {/if}

      <!-- Sync section -->
      {#if canSync()}
        <div class="p-3 bg-surface border border-border rounded-xl">
          <span class="text-[10px] font-medium text-muted uppercase tracking-wide">Sync</span>
          <div class="flex items-center gap-2 mt-2">
            <button
              onclick={handleSyncUp}
              disabled={isSyncing}
              class="px-3 py-1 text-[10px] border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded"
            >
              Push
            </button>
            <button
              onclick={handleSyncDown}
              disabled={isSyncing}
              class="px-3 py-1 text-[10px] border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded"
            >
              Pull
            </button>
            {#if isSyncing}
              <LoadingSpinner />
            {/if}
          </div>
          {#if syncStatus}
            <div class="mt-2 text-[9px] text-muted">
              {#if syncStatus.has_remote}
                <span>v{syncStatus.remote_version}</span>
                {#if syncStatus.updated_at}
                  <span class="ml-2">Last synced: {new Date(syncStatus.updated_at).toLocaleDateString()}</span>
                {/if}
              {:else}
                <span>No remote profile yet</span>
              {/if}
            </div>
          {/if}
        </div>
      {/if}

      <div class="flex-1"></div>

      {#if error}
        <div class="p-2 bg-tint border border-border rounded-xl text-[10px] text-error">
          {error}
        </div>
      {/if}

      <div class="flex items-center justify-between shrink-0">
        <span class="text-[10px] text-muted">Stored on Noren servers</span>
        {#if canExport()}
          <button
            onclick={handleExport}
            disabled={isExporting}
            class="px-3 py-1.5 text-xs border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
          >
            {isExporting ? "Exporting..." : "Export"}
          </button>
        {:else}
          <button
            onclick={() => handleUpgrade("export")}
            class="px-3 py-1.5 text-xs border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
            title="One-time purchase to export your profile"
          >
            Export <span class="text-[8px] text-secondary font-medium">$</span>
          </button>
        {/if}
      </div>
    </div>
  {:else}
    <!-- Local profile — view/edit -->
    <div class="flex flex-col h-full">
      <!-- Tabs -->
      <div class="flex items-center gap-1 px-4 py-3 border-b border-border shrink-0 overflow-x-auto">
        <button
          onclick={() => switchTab("core")}
          class="px-2.5 py-1.5 text-[10px] uppercase tracking-wide cursor-pointer transition-colors shrink-0
            {activeTab === 'core'
              ? 'border-b-2 border-accent text-accent font-medium'
              : 'border-b-2 border-transparent text-muted hover:text-foreground'}"
        >
          Core Identity
        </button>

        {#if overview?.formats}
          {#each overview.formats as fmt}
            <button
              onclick={() => switchTab(fmt)}
              class="px-2.5 py-1.5 text-[10px] uppercase tracking-wide cursor-pointer transition-colors shrink-0
                {activeTab === fmt
                  ? 'border-b-2 border-accent text-accent font-medium'
                  : 'border-b-2 border-transparent text-muted hover:text-foreground'}"
            >
              {fmt}
            </button>
          {/each}
        {/if}

        <!-- Add format button -->
        {#if !showAddFormat}
          <button
            onclick={() => { showAddFormat = true; }}
            class="px-1.5 py-1 text-[10px] text-muted hover:text-secondary cursor-pointer rounded transition-colors shrink-0"
            title="Add format context"
          >
            +
          </button>
        {:else}
          <form
            onsubmit={(e) => { e.preventDefault(); handleAddFormat(); }}
            class="flex items-center gap-1 shrink-0"
          >
            <input
              bind:value={newFormatName}
              class="w-20 px-1.5 py-0.5 text-[10px] border border-secondary bg-surface text-foreground rounded focus:outline-none"
              placeholder="format name"
              autofocus
            />
            <button
              type="submit"
              class="text-[10px] text-secondary cursor-pointer hover:text-foreground"
            >
              Add
            </button>
            <button
              type="button"
              onclick={() => { showAddFormat = false; newFormatName = ""; }}
              class="text-[10px] text-muted cursor-pointer hover:text-foreground"
            >
              Cancel
            </button>
          </form>
        {/if}
      </div>

      <!-- Content area -->
      <div class="flex-1 flex flex-col min-h-0 px-4 py-3 gap-2">
        {#if isEditing}
          <textarea
            bind:value={editContent}
            class="flex-1 p-3 text-xs leading-relaxed border border-border bg-surface text-foreground resize-none placeholder-muted rounded-md focus:outline-none focus:border-secondary"
            placeholder={activeTab === "core"
              ? "Describe your writing voice, tone, and style..."
              : `Describe how you write for ${activeTab} specifically...`}
          ></textarea>
          <div class="flex items-center gap-2 shrink-0">
            <button
              onclick={handleCancelEdit}
              class="px-3 py-1.5 text-xs border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
            >
              Cancel
            </button>
            <button
              onclick={handleSave}
              class="px-3 py-1.5 text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer rounded-md"
            >
              Save
            </button>
          </div>
        {:else}
          <div class="flex-1 overflow-y-auto">
            {#if displayContent.trim()}
              <p class="text-xs text-foreground leading-relaxed whitespace-pre-wrap selectable">{displayContent}</p>
            {:else}
              <p class="text-xs text-muted italic">No content for this context yet.</p>
            {/if}
          </div>
          <div class="flex items-center justify-between shrink-0">
            <button
              onclick={handleEdit}
              class="px-3 py-1.5 text-xs border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
            >
              Edit
            </button>
            {#if saveSuccess}
              <span class="text-[10px] text-secondary font-medium animate-fade-in-up">Saved</span>
            {/if}
          </div>
        {/if}
      </div>

      {#if error}
        <div class="mx-4 mb-2 p-2 bg-tint border border-border rounded-xl text-[10px] text-error">
          {error}
        </div>
      {/if}

      <!-- Pro feature nudges -->
      <div class="px-4 pb-4 flex flex-col gap-2 shrink-0">
        <!-- Extraction nudge (if no format contexts) -->
        {#if overview && overview.formats.length === 0 && !isEditing}
          <div class="p-2.5 bg-tint border border-secondary/15 rounded-xl">
            <p class="text-[10px] text-muted leading-relaxed">
              <span class="text-secondary font-medium">Want format-specific voices?</span> AI Extraction analyzes your writing samples and creates context-aware profiles for email, social media, long-form, and more.
            </p>
            <div class="flex gap-2 items-center mt-1.5">
              {#if canExtract()}
                <span class="text-[10px] text-secondary font-medium">Available in the desktop app</span>
              {:else}
                <button
                  onclick={() => handleUpgrade("extraction")}
                  class="text-[10px] text-secondary font-medium cursor-pointer hover:text-foreground uppercase tracking-wide"
                >
                  One-time $19
                </button>
                <span class="text-[10px] text-muted">or</span>
                <button
                  onclick={() => handleUpgrade("pro")}
                  class="text-[10px] text-secondary font-medium cursor-pointer hover:text-foreground uppercase tracking-wide"
                >
                  Included with Pro
                </button>
              {/if}
            </div>
          </div>
        {/if}

        <!-- Living Profile + Sync nudge -->
        {#if !isPro() && !isEditing}
          <div class="p-2.5 bg-tint border border-secondary/10 rounded-xl flex gap-3">
            <div class="flex-1">
              <p class="text-[10px] font-medium text-secondary">Noren Pro</p>
              <p class="text-[10px] text-muted leading-relaxed mt-0.5">
                Living Profile that evolves as you write. Cross-device sync. AI extraction. All included.
              </p>
            </div>
            <button
              onclick={() => handleUpgrade("pro")}
              class="self-center px-3 py-1.5 text-[10px] font-medium bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer rounded-md uppercase tracking-wide shrink-0"
            >
              Upgrade
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* Voice Dimensions */
  .pv-dims {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 10px;
  }
  .pv-dim-row { display: flex; flex-direction: column; gap: 4px; }
  .pv-dim-header { display: flex; justify-content: space-between; align-items: baseline; }
  .pv-dim-label { font-size: 11px; font-weight: 600; color: var(--color-foreground); }
  .pv-dim-value { font-size: 10px; color: var(--color-muted); text-transform: lowercase; }
  .pv-dim-track { position: relative; height: 4px; background: var(--color-tint); border-radius: 100px; }
  .pv-dim-indicator {
    position: absolute; top: -3px; width: 10px; height: 10px; border-radius: 50%;
    background: var(--color-secondary); border: 2px solid var(--color-surface);
    box-shadow: 0 1px 3px rgba(0,0,0,0.15); transform: translateX(-50%);
  }
  .pv-dim-ends { display: flex; justify-content: space-between; margin-top: 2px; }
  .pv-dim-end { font-size: 9px; color: var(--color-muted); opacity: 0.7; }

  /* Pattern Depth */
  .pv-depth { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
  .pv-depth-item { display: flex; align-items: baseline; gap: 6px; }
  .pv-depth-count { font-size: 18px; font-weight: 700; color: var(--color-foreground); line-height: 1; font-variant-numeric: tabular-nums; }
  .pv-depth-name { font-size: 10px; color: var(--color-muted); line-height: 1.3; }
  .pv-depth-full { grid-column: 1 / -1; padding-top: 4px; border-top: 1px solid var(--color-border); margin-top: 2px; }

  /* Sentence Rhythm */
  .pv-rhythm-bar { display: flex; height: 8px; border-radius: 100px; overflow: hidden; gap: 1px; }
  .pv-rhythm-seg { height: 100%; }
  .pv-rhythm-short { background: var(--color-secondary); border-radius: 100px 0 0 100px; }
  .pv-rhythm-medium { background: var(--color-accent); }
  .pv-rhythm-long { background: var(--color-warning); }
  .pv-rhythm-vlong { background: #C23B2A; border-radius: 0 100px 100px 0; }
  .pv-rhythm-legend { display: flex; gap: 10px; margin-top: 8px; flex-wrap: wrap; }
  .pv-rhythm-legend-item { display: flex; align-items: center; gap: 4px; font-size: 9px; color: var(--color-muted); }
  .pv-rhythm-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .pv-rhythm-stats { display: flex; gap: 14px; margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--color-border); }
  .pv-rhythm-stat { display: flex; flex-direction: column; }
  .pv-rhythm-stat-val { font-size: 14px; font-weight: 700; color: var(--color-foreground); font-variant-numeric: tabular-nums; }
  .pv-rhythm-stat-lbl { font-size: 9px; color: var(--color-muted); }

  /* Format Cards */
  .pv-format-list { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .pv-format-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: var(--color-tint); border-radius: 8px; }
  .pv-format-accent { width: 3px; height: 24px; border-radius: 2px; flex-shrink: 0; }
  .pv-format-name { font-size: 11px; font-weight: 600; color: var(--color-foreground); flex: 1; }
  .pv-format-stats { display: flex; gap: 10px; }
  .pv-format-stat { font-size: 10px; color: var(--color-muted); font-variant-numeric: tabular-nums; }
  .pv-format-stat :global(strong) { font-weight: 600; color: var(--color-foreground); }

  /* Guided Edit */
  .ge-card {
    position: relative;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 12px 14px;
  }
  .ge-card::before {
    content: '';
    position: absolute;
    top: 0; left: 12px; right: 12px;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--color-secondary), transparent);
    opacity: 0.25;
    border-radius: 1px;
  }
  .ge-input-row { display: flex; gap: 8px; margin-top: 10px; align-items: stretch; }
  .ge-input {
    flex: 1; padding: 8px 12px; font-size: 12px; font-family: inherit;
    border: 1.5px solid var(--color-border); border-radius: 8px;
    background: var(--color-background); color: var(--color-foreground);
    outline: none; transition: border-color 0.15s;
  }
  .ge-input:focus { border-color: var(--color-secondary); }
  .ge-input::placeholder { color: var(--color-muted); opacity: 0.6; }
  .ge-submit {
    padding: 8px 14px; font-size: 11px; font-weight: 600; font-family: inherit;
    color: white; background: var(--color-secondary); border: none; border-radius: 8px;
    cursor: pointer; transition: all 0.15s; white-space: nowrap; flex-shrink: 0;
  }
  .ge-submit:hover { opacity: 0.9; }
  .ge-submit:disabled { opacity: 0.4; cursor: not-allowed; }
  .ge-format-row { display: flex; gap: 6px; margin-top: 8px; }
  .ge-format-pill {
    padding: 3px 8px; font-size: 10px; font-family: inherit; border-radius: 4px;
    cursor: pointer; transition: all 0.15s; border: 1px solid var(--color-border);
    background: transparent; color: var(--color-muted);
  }
  .ge-format-pill.active { background: var(--color-secondary); color: white; border-color: var(--color-secondary); }
  .ge-loading { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
  .ge-result {
    margin-top: 10px; padding: 10px 12px; background: var(--color-tint); border-radius: 8px;
  }
  .ge-result-noop { background: var(--color-surface); border: 1px solid var(--color-border); }
  .ge-result-msg { font-size: 11px; font-weight: 500; }
  .ge-result-toggle {
    font-size: 10px; color: var(--color-secondary); cursor: pointer; margin-top: 6px;
    background: none; border: none; font-family: inherit; padding: 0;
  }
  .ge-result-toggle:hover { text-decoration: underline; }
  .ge-diff { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
  .ge-diff-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-muted); font-weight: 600; }
  .ge-diff-old, .ge-diff-new {
    font-size: 10px; font-family: monospace; padding: 8px; border-radius: 6px;
    line-height: 1.6; max-height: 80px; overflow: hidden; white-space: pre-wrap; word-break: break-word;
  }
  .ge-diff-old { background: #fdf0f0; color: var(--color-muted); border: 1px solid #e8d4d4; }
  .ge-diff-new { background: #f0fdf4; color: var(--color-foreground); border: 1px solid #d4e8d4; }
</style>
