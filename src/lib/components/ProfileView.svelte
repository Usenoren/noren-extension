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
    getSettings,
    type ProfileContent,
    type ProfileOverview,
    type ProfileMetadata,
    type RefreshHistoryEntry,
    type SyncStatus,
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
    <div class="flex flex-col gap-3 h-full px-4 py-4 overflow-y-auto">
      <div class="p-3 card-hero">
        <p class="text-sm font-medium text-foreground">Voice profile on Noren servers</p>
        <p class="text-[10px] text-muted mt-1 leading-relaxed">
          Your extracted profile is securely stored on Noren servers and used automatically when generating text.
        </p>
      </div>

      {#if overview.formats.length > 0}
        <div class="p-3 bg-surface border border-border rounded-xl">
          <span class="text-[10px] font-medium text-muted uppercase tracking-wide">Formats</span>
          <div class="flex gap-1.5 mt-1.5 flex-wrap">
            {#each overview.formats as fmt}
              <span class="px-2 py-0.5 text-xs bg-tint border border-border rounded text-secondary">{fmt}</span>
            {/each}
          </div>
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
