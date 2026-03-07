<script lang="ts">
  import {
    readProfileContent,
    saveProfileEdit,
    getProfileOverview,
    createCheckout,
    getSettings,
    type ProfileContent,
    type ProfileOverview,
  } from "$lib/api/noren";
  import {
    canExtract,
    canLivingProfile,
    canSync,
    isPro,
    refresh as refreshSubscription,
  } from "$lib/stores/subscription.svelte";
  import { friendlyError } from "$lib/utils/errors";
  import LoadingSpinner from "./LoadingSpinner.svelte";

  // --- State ---
  let overview = $state<ProfileOverview | null>(null);
  let profile = $state<ProfileContent | null>(null);
  let isLoading = $state(true);
  let error = $state("");
  let saveSuccess = $state(false);

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
      if (overview.exists) {
        profile = await readProfileContent();
      }
      await refreshSubscription();
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
          <div class="w-10 h-10 mx-auto mb-3 rounded-full bg-primary/10 flex items-center justify-center">
            <svg class="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
            </svg>
          </div>
          <h3 class="text-sm font-medium text-foreground">Create Your Voice Profile</h3>
          <p class="text-[11px] text-muted mt-1.5 leading-relaxed max-w-[280px]">
            Describe how you write — your tone, style, patterns. Noren uses this to make every generation sound like you.
          </p>
        </div>

        <button
          onclick={() => { isCreating = true; }}
          class="px-4 py-2 text-xs font-medium bg-primary text-white hover:bg-primary-hover transition-colors cursor-pointer rounded-lg"
        >
          Write My Profile
        </button>
      </div>

      <!-- AI Extraction nudge -->
      <div class="mx-4 mb-4 p-3 bg-tint border border-secondary/20 rounded-lg">
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
          class="px-3 py-1.5 text-xs font-medium bg-primary text-white hover:bg-primary-hover transition-colors cursor-pointer rounded-md"
        >
          Save Profile
        </button>
      </div>
    </div>
  {:else}
    <!-- Profile exists — view/edit -->
    <div class="flex flex-col h-full">
      <!-- Tabs -->
      <div class="flex items-center gap-1 px-4 py-3 border-b border-border shrink-0 overflow-x-auto">
        <button
          onclick={() => switchTab("core")}
          class="px-2.5 py-1 text-[10px] uppercase tracking-wide cursor-pointer rounded-md transition-colors shrink-0
            {activeTab === 'core'
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-muted hover:text-foreground hover:bg-tint'}"
        >
          Core Identity
        </button>

        {#if overview?.formats}
          {#each overview.formats as fmt}
            <button
              onclick={() => switchTab(fmt)}
              class="px-2.5 py-1 text-[10px] uppercase tracking-wide cursor-pointer rounded-md transition-colors shrink-0
                {activeTab === fmt
                  ? 'bg-secondary/10 text-secondary font-medium'
                  : 'text-muted hover:text-foreground hover:bg-tint'}"
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
              class="px-3 py-1.5 text-xs font-medium bg-primary text-white hover:bg-primary-hover transition-colors cursor-pointer rounded-md"
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
        <div class="mx-4 mb-2 p-2 bg-tint border border-border rounded-lg text-[10px] text-error">
          {error}
        </div>
      {/if}

      <!-- Pro feature nudges -->
      <div class="px-4 pb-4 flex flex-col gap-2 shrink-0">
        <!-- Extraction nudge (if no format contexts) -->
        {#if overview && overview.formats.length === 0 && !isEditing}
          <div class="p-2.5 bg-tint border border-secondary/15 rounded-lg">
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
          <div class="p-2.5 bg-tint border border-secondary/10 rounded-lg flex gap-3">
            <div class="flex-1">
              <p class="text-[10px] font-medium text-secondary">Noren Pro</p>
              <p class="text-[10px] text-muted leading-relaxed mt-0.5">
                Living Profile that evolves as you write. Cross-device sync. AI extraction. All included.
              </p>
            </div>
            <button
              onclick={() => handleUpgrade("pro")}
              class="self-center px-3 py-1.5 text-[10px] font-medium bg-secondary text-white hover:bg-secondary/90 transition-colors cursor-pointer rounded-md uppercase tracking-wide shrink-0"
            >
              Upgrade
            </button>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
