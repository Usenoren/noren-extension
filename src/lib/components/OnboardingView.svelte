<script lang="ts">
  import {
    norenProLogin,
    norenProSignup,
    setInferenceMode,
    googleOAuthInit,
    googleOAuthPoll,
  } from "$lib/api/noren";
  import { friendlyError } from "$lib/utils/errors";
  import LoadingSpinner from "./LoadingSpinner.svelte";

  let { oncomplete }: { oncomplete: (tab: "generate" | "settings") => void } = $props();

  type Screen = "welcome" | "signin";
  let screen: Screen = $state("welcome");

  let authMode = $state<"login" | "signup">("login");
  let email = $state("");
  let password = $state("");
  let loading = $state(false);
  let googleLoading = $state(false);
  let error = $state("");

  async function handleByok() {
    await chrome.storage.local.set({ onboarding_complete: true });
    oncomplete("settings");
  }

  async function handleProAuth() {
    if (!email.trim() || !password.trim()) return;
    loading = true;
    error = "";
    try {
      if (authMode === "signup") {
        await norenProSignup(email.trim(), password.trim());
      } else {
        await norenProLogin(email.trim(), password.trim());
      }
      await setInferenceMode("noren_pro");
      await chrome.storage.local.set({ onboarding_complete: true });
      oncomplete("generate");
    } catch (e) {
      error = friendlyError(e);
    } finally {
      loading = false;
    }
  }

  async function handleGoogleSignIn() {
    googleLoading = true;
    error = "";
    try {
      const { auth_url, session_id } = await googleOAuthInit();
      window.open(auth_url, "_blank");

      for (let i = 0; i < 150; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!googleLoading) return;
        try {
          const result = await googleOAuthPoll(session_id);
          if (result.complete) {
            await setInferenceMode("noren_pro");
            await chrome.storage.local.set({ onboarding_complete: true });
            oncomplete("generate");
            return;
          }
        } catch (e) {
          error = friendlyError(e);
          return;
        }
      }
      error = "Sign-in timed out. Please try again.";
    } catch (e) {
      error = friendlyError(e);
    } finally {
      googleLoading = false;
    }
  }
</script>

<div class="relative flex flex-col items-center justify-center h-screen bg-background px-6 overflow-hidden">
  <!-- Decorative threads — always visible behind both screens -->
  <div class="absolute inset-0 pointer-events-none overflow-hidden">
    <div class="absolute top-[12%] -left-[10%] w-[120%] h-px onboarding-thread rotate-[8deg]"></div>
    <div class="absolute top-[32%] -left-[10%] w-[120%] h-px onboarding-thread rotate-[-4deg]"></div>
    <div class="absolute top-[58%] -left-[10%] w-[120%] h-px onboarding-thread rotate-[5deg]"></div>
    <div class="absolute top-[80%] -left-[10%] w-[120%] h-px onboarding-thread rotate-[-3deg]"></div>
  </div>

  {#if screen === "welcome"}
    <!-- Screen 1: Welcome -->
    <div class="relative flex flex-col items-center max-w-xs w-full animate-fade-in-up mt-4">
      <!-- Logo -->
      <div class="relative mb-8">
        <div class="w-16 h-16 rounded-2xl bg-primary flex items-center justify-center onboarding-logo-glow">
          <span class="text-white font-heading text-[28px] font-semibold">N</span>
        </div>
      </div>

      <!-- Headline -->
      <h1 class="font-heading text-[26px] text-foreground tracking-tight text-center leading-tight">
        Personalise the Weave
      </h1>
      <p class="text-[13px] text-muted text-center mt-3 leading-relaxed">
        Noren learns how you write and produces text that sounds exactly like you.
      </p>

      <!-- Feature pills -->
      <div class="flex flex-wrap justify-center gap-1.5 mt-6">
        <span class="px-2.5 py-1 text-[10px] bg-secondary/10 text-secondary rounded-full">Voice profile</span>
        <span class="px-2.5 py-1 text-[10px] bg-secondary/10 text-secondary rounded-full">Context-aware</span>
        <span class="px-2.5 py-1 text-[10px] bg-secondary/10 text-secondary rounded-full">One click</span>
      </div>

      <!-- Primary CTA -->
      <button
        onclick={() => { screen = "signin"; }}
        class="w-full mt-10 py-3 text-sm font-medium text-white transition-all cursor-pointer rounded-lg onboarding-cta"
      >
        Get Started with Noren Pro
      </button>

      <!-- BYOK link -->
      <button
        onclick={handleByok}
        class="text-[11px] text-muted hover:text-secondary transition-colors cursor-pointer mt-5"
      >
        Use my own provider instead
      </button>
    </div>

  {:else}
    <!-- Screen 2: Noren Pro Sign In -->
    <div class="flex flex-col gap-4 max-w-xs w-full animate-fade-in-up">
      <div class="text-center mb-2">
        <h2 class="font-heading text-lg text-foreground">Sign in to Noren Pro</h2>
        <p class="text-xs text-muted mt-1">No API key needed — we handle inference for you</p>
      </div>

      <!-- Auth mode toggle -->
      <div class="flex gap-1">
        <button
          onclick={() => { authMode = "login"; error = ""; }}
          class="flex-1 px-2 py-1 text-[10px] uppercase tracking-wide cursor-pointer rounded-md
            {authMode === 'login'
              ? 'bg-secondary text-white font-medium'
              : 'bg-surface text-muted border border-border'}"
        >
          Sign in
        </button>
        <button
          onclick={() => { authMode = "signup"; error = ""; }}
          class="flex-1 px-2 py-1 text-[10px] uppercase tracking-wide cursor-pointer rounded-md
            {authMode === 'signup'
              ? 'bg-secondary text-white font-medium'
              : 'bg-surface text-muted border border-border'}"
        >
          Create account
        </button>
      </div>

      <!-- Google Sign In -->
      <button
        onclick={handleGoogleSignIn}
        disabled={googleLoading || loading}
        class="w-full py-2 text-xs font-medium bg-surface border border-border text-foreground hover:border-secondary transition-colors cursor-pointer disabled:opacity-50 rounded-md flex items-center justify-center gap-2"
      >
        {#if googleLoading}
          <LoadingSpinner /> Waiting for Google...
        {:else}
          <svg class="w-3.5 h-3.5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        {/if}
      </button>

      <div class="relative">
        <div class="absolute inset-0 flex items-center">
          <div class="w-full border-t border-border"></div>
        </div>
        <div class="relative flex justify-center text-[10px]">
          <span class="px-2 bg-background text-muted">or</span>
        </div>
      </div>

      <!-- Email / Password -->
      <input
        type="email"
        bind:value={email}
        class="px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
        placeholder="Email"
      />
      <input
        type="password"
        bind:value={password}
        onkeydown={(e) => { if (e.key === "Enter") handleProAuth(); }}
        class="px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
        placeholder="Password"
      />
      <button
        onclick={handleProAuth}
        disabled={loading || !email.trim() || !password.trim()}
        class="w-full py-2 text-xs font-medium bg-secondary text-white hover:bg-secondary/90 transition-colors cursor-pointer disabled:opacity-50 rounded-md"
      >
        {#if loading}
          <span class="inline-flex items-center gap-1"><LoadingSpinner /> {authMode === "signup" ? "Creating..." : "Signing in..."}</span>
        {:else}
          {authMode === "signup" ? "Create account" : "Sign in"}
        {/if}
      </button>

      <!-- Error -->
      {#if error}
        <div class="p-2 bg-tint border border-border rounded-lg text-xs text-muted leading-relaxed">
          {error}
        </div>
      {/if}

      <!-- Back link -->
      <button
        onclick={() => { screen = "welcome"; error = ""; }}
        class="text-xs text-muted hover:text-secondary transition-colors cursor-pointer mt-1"
      >
        Back
      </button>
    </div>
  {/if}
</div>

<style>
  .onboarding-logo-glow {
    box-shadow: 0 0 28px rgba(59, 107, 138, 0.3), 0 0 56px rgba(59, 107, 138, 0.1);
  }

  .onboarding-cta {
    background: linear-gradient(135deg, #3B6B8A 0%, #2D5A75 100%);
    box-shadow: 0 4px 16px rgba(59, 107, 138, 0.35), 0 1px 3px rgba(0, 0, 0, 0.15);
  }
  .onboarding-cta:hover {
    background: linear-gradient(135deg, #4478A0 0%, #3B6B8A 100%);
    box-shadow: 0 6px 24px rgba(59, 107, 138, 0.45), 0 2px 4px rgba(0, 0, 0, 0.15);
  }

  .onboarding-thread {
    background: linear-gradient(90deg, transparent 0%, var(--color-secondary) 50%, transparent 100%);
    opacity: 0.06;
  }
</style>
