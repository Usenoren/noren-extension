<script lang="ts">
  import { getSettings, getContextText, getProfileOverview } from "$lib/api/noren";
  import { refresh as refreshSubscription } from "$lib/stores/subscription.svelte";
  import GenerateView from "$lib/components/GenerateView.svelte";
  import ChatView from "$lib/components/ChatView.svelte";
  import ProfileView from "$lib/components/ProfileView.svelte";
  import SettingsView from "$lib/components/SettingsView.svelte";
  import OnboardingView from "$lib/components/OnboardingView.svelte";
  import NorenMark from "$lib/components/NorenMark.svelte";
  import AnnouncementBell from "$lib/components/AnnouncementBell.svelte";

  type View = "generate" | "chat" | "profile" | "settings";
  let view: View = $state("generate");
  let loading = $state(true);
  let showOnboarding = $state(false);
  let contextText = $state("");
  let profileName = $state("");

  const navItems: { id: View; label: string; icon: string }[] = [
    { id: "generate", label: "Weave", icon: "pen" },
    { id: "chat", label: "Chat", icon: "chat" },
    { id: "profile", label: "Profile", icon: "profile" },
    { id: "settings", label: "Settings", icon: "gear" },
  ];

  $effect(() => {
    chrome.storage.local.get("onboarding_complete").then(({ onboarding_complete }) => {
      if (!onboarding_complete) {
        showOnboarding = true;
        loading = false;
        return;
      }
      return getSettings().then(async (settings) => {
        if (
          settings.inference_mode === "byok" &&
          !settings.has_key &&
          settings.provider.requiresKey
        ) {
          view = "settings";
        }

        // Fetch context text once, pass to both views
        const ctx = await getContextText();
        if (ctx) contextText = ctx;

        // Fetch profile name for voice badge
        try {
          const overview = await getProfileOverview();
          if (overview.exists && overview.name) profileName = overview.name;
        } catch {}

        if (settings.noren_pro_logged_in) {
          refreshSubscription();
        }
        loading = false;
      });
    }).catch(() => {
      loading = false;
    });
  });

  function clearContext() {
    contextText = "";
  }

  function handleOnboardingComplete(tab: "generate" | "settings") {
    showOnboarding = false;
    view = tab;
    if (tab === "generate") {
      refreshSubscription();
    }
  }
</script>

{#if loading}
  <div class="flex items-center justify-center h-screen bg-background">
    <span class="text-sm text-muted">Loading...</span>
  </div>
{:else if showOnboarding}
  <OnboardingView oncomplete={handleOnboardingComplete} />
{:else}
<div class="flex flex-col h-screen overflow-hidden bg-background">
  <!-- Tab bar -->
  <nav class="flex items-center gap-1 px-3 py-2 shrink-0 bg-surface border-b border-border">
    {#each navItems as item}
      <button
        onclick={() => { view = item.id; }}
        class="relative flex items-center gap-1.5 px-3 py-2 text-xs rounded-md transition-colors cursor-pointer
          {view === item.id
            ? 'text-accent font-medium'
            : 'text-muted hover:bg-foreground/[0.04] hover:text-foreground'}"
      >
        {#if item.icon === "pen"}
          <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
          </svg>
        {:else if item.icon === "chat"}
          <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
          </svg>
        {:else if item.icon === "profile"}
          <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
          </svg>
        {:else if item.icon === "gear"}
          <svg class="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
            <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        {/if}
        <span class="font-heading italic font-normal tracking-normal">{item.label}</span>
        {#if view === item.id}
          <span class="absolute bottom-0 left-1/2 -translate-x-1/2 w-4 h-[3px] rounded-full bg-accent" style="box-shadow: 0 0 8px var(--color-accent-glow), 0 0 16px var(--color-accent-glow)"></span>
        {/if}
      </button>
    {/each}

    <span class="ml-auto flex items-center gap-1.5">
      {#if profileName}
        <div class="voice-badge">
          <div class="voice-badge-dot"></div>
          <span class="font-mono text-[8px] font-medium uppercase tracking-wide text-signal">{profileName}</span>
        </div>
      {/if}
      <AnnouncementBell />
      <span style="color:var(--color-muted)">
        <NorenMark width={12} height={14} />
      </span>
    </span>
  </nav>

  <!-- Content area — all views stay mounted to preserve state -->
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden relative">
    <div class="absolute inset-0 flex flex-col overflow-hidden" class:hidden={view !== "generate"}>
      <GenerateView initialContext={contextText} oncontextused={clearContext} />
    </div>
    <div class="absolute inset-0 flex flex-col overflow-hidden" class:hidden={view !== "chat"}>
      <ChatView initialContext={contextText} oncontextused={clearContext} />
    </div>
    <div class="absolute inset-0 flex flex-col overflow-hidden" class:hidden={view !== "profile"}>
      <ProfileView />
    </div>
    <div class="absolute inset-0 flex flex-col overflow-hidden" class:hidden={view !== "settings"}>
      <SettingsView />
    </div>
  </div>
</div>
{/if}
