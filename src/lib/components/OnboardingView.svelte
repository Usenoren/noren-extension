<script lang="ts">
  import {
    norenProLogin,
    norenProSignup,
    setInferenceMode,
    googleOAuthInit,
    googleOAuthPoll,
    verifyEmail,
    resendOtp,
    requestPasswordReset,
    resetPassword,
    getProfileOverview,
  } from "$lib/api/noren";
  import { PALETTES, setAndPersistTheme, applyTheme, type PaletteId } from "$lib/stores/theme.svelte";
  import { friendlyError } from "$lib/utils/errors";
  import LoadingSpinner from "./LoadingSpinner.svelte";
  import NorenMark from "./NorenMark.svelte";

  let { oncomplete }: { oncomplete: (tab: "generate" | "settings" | "profile") => void } = $props();

  type Screen = "welcome" | "palette" | "signin" | "otp" | "next-steps";
  let screen: Screen = $state("welcome");
  let pendingPath = $state<"signin" | "byok">("signin");
  let selectedPalette = $state<PaletteId>("kon");

  // Next-steps state
  let authCompleteMode = $state<"pro" | "byok">("pro");
  let hasExistingProfile = $state(false);
  let nextStepsLoading = $state(false);

  async function goToNextSteps(mode: "pro" | "byok") {
    authCompleteMode = mode;
    if (mode === "pro") {
      nextStepsLoading = true;
      try {
        const overview = await getProfileOverview();
        hasExistingProfile = overview.exists;
      } catch {
        hasExistingProfile = false;
      }
      nextStepsLoading = false;
    }
    screen = "next-steps";
  }

  let authMode = $state<"login" | "signup">("login");
  let email = $state("");
  let password = $state("");
  let passwordResetOpen = $state(false);
  let passwordResetLoading = $state(false);
  let passwordResetMessage = $state("");
  let passwordResetEmail = $state("");
  let passwordResetCode = $state("");
  let passwordResetNewPassword = $state("");
  let passwordResetConfirmPassword = $state("");
  let loading = $state(false);
  let googleLoading = $state(false);
  let error = $state("");

  // OTP verification state
  let otpCode = $state("");
  let otpLoading = $state(false);
  let otpMessage = $state("");
  let resendCooldown = $state(0);

  function showOtp(nextEmail: string | null | undefined, message = "Enter the verification code we sent to your email.") {
    email = nextEmail || email;
    password = "";
    otpMessage = message;
    error = "";
    screen = "otp";
  }

  async function handleByok() {
    await chrome.storage.local.set({ onboarding_complete: true });
    window.dispatchEvent(new CustomEvent("noren:auth-changed", { detail: { mode: "byok" } }));
    goToNextSteps("byok");
  }

  async function handleProAuth() {
    if (!email.trim() || !password.trim()) return;
    loading = true;
    error = "";
    try {
      if (authMode === "signup") {
        const status = await norenProSignup(email.trim(), password.trim());
        showOtp(status.email || email.trim(), "Check your email for a verification code.");
        startResendCooldown();
      } else {
        const status = await norenProLogin(email.trim(), password.trim());
        if (!status.email_verified) {
          showOtp(status.email || email.trim());
          return;
        }
        await setInferenceMode("noren_pro");
        await chrome.storage.local.set({ onboarding_complete: true });
        window.dispatchEvent(new CustomEvent("noren:auth-changed", { detail: { mode: "noren_pro" } }));
        goToNextSteps("pro");
      }
    } catch (e) {
      error = friendlyError(e);
    } finally {
      loading = false;
    }
  }

  async function handleRequestPasswordReset() {
    const targetEmail = (passwordResetEmail || email).trim();
    if (!targetEmail) {
      error = "Enter your email first.";
      return;
    }
    passwordResetLoading = true;
    error = "";
    passwordResetMessage = "";
    try {
      passwordResetEmail = targetEmail;
      passwordResetMessage = await requestPasswordReset(targetEmail);
    } catch (e) {
      error = friendlyError(e);
    } finally {
      passwordResetLoading = false;
    }
  }

  async function handleResetPassword() {
    if (!passwordResetEmail.trim() || !passwordResetCode.trim() || !passwordResetNewPassword) return;
    if (passwordResetNewPassword !== passwordResetConfirmPassword) {
      error = "Passwords don't match.";
      return;
    }
    passwordResetLoading = true;
    error = "";
    try {
      passwordResetMessage = await resetPassword(
        passwordResetEmail.trim(),
        passwordResetCode.trim(),
        passwordResetNewPassword,
      );
      authMode = "login";
      email = passwordResetEmail.trim();
      password = "";
      passwordResetCode = "";
      passwordResetNewPassword = "";
      passwordResetConfirmPassword = "";
    } catch (e) {
      error = friendlyError(e);
    } finally {
      passwordResetLoading = false;
    }
  }

  function startResendCooldown() {
    resendCooldown = 60;
    const interval = setInterval(() => {
      resendCooldown--;
      if (resendCooldown <= 0) clearInterval(interval);
    }, 1000);
  }

  async function handleVerifyOtp() {
    if (!otpCode.trim()) return;
    otpLoading = true;
    error = "";
    otpMessage = "";
    try {
      await verifyEmail(otpCode.trim());
      otpCode = "";
      email = "";
      await setInferenceMode("noren_pro");
      await chrome.storage.local.set({ onboarding_complete: true });
      window.dispatchEvent(new CustomEvent("noren:auth-changed", { detail: { mode: "noren_pro" } }));
      goToNextSteps("pro");
    } catch (e) {
      error = friendlyError(e);
    } finally {
      otpLoading = false;
    }
  }

  async function handleResendOtp() {
    if (resendCooldown > 0) return;
    error = "";
    otpMessage = "";
    try {
      const msg = await resendOtp();
      otpMessage = msg;
      startResendCooldown();
    } catch (e) {
      error = friendlyError(e);
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
            window.dispatchEvent(new CustomEvent("noren:auth-changed", { detail: { mode: "noren_pro" } }));
            goToNextSteps("pro");
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
        <div class="w-16 h-16 rounded-2xl flex items-center justify-center onboarding-logo-glow" style="color:var(--color-primary)">
          <NorenMark width={36} height={43} />
        </div>
      </div>

      <!-- Headline -->
      <h1 class="text-display font-heading text-foreground tracking-tight text-center leading-tight">
        Personalize the Weave
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
        onclick={() => { pendingPath = "signin"; screen = "palette"; }}
        class="w-full mt-10 py-3 text-sm font-medium text-white transition-all cursor-pointer rounded-md bg-accent hover:bg-accent-hover"
      >
        Get Started with Noren Pro
      </button>

      <!-- Returning user: jump straight to signin, skip palette -->
      <button
        onclick={() => { pendingPath = "signin"; authMode = "login"; screen = "signin"; }}
        class="w-full mt-3 py-2.5 text-xs font-medium transition-all cursor-pointer rounded-md flex items-center justify-center gap-2"
        style="background: transparent; border: 1px solid rgba(200,212,221,0.22); color: var(--color-primary);"
        onmouseenter={(e) => { e.currentTarget.style.borderColor = 'rgba(200,212,221,0.4)'; e.currentTarget.style.background = 'rgba(200,212,221,0.04)'; }}
        onmouseleave={(e) => { e.currentTarget.style.borderColor = 'rgba(200,212,221,0.22)'; e.currentTarget.style.background = 'transparent'; }}
      >
        <svg class="w-3.5 h-3.5 opacity-85" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
          <polyline points="10 17 15 12 10 7"/>
          <line x1="15" y1="12" x2="3" y2="12"/>
        </svg>
        Sign in to existing account
      </button>

      <!-- BYOK link -->
      <button
        onclick={() => { pendingPath = "byok"; screen = "palette"; }}
        class="text-[11px] text-muted hover:text-secondary transition-colors cursor-pointer mt-4"
      >
        Use my own provider instead
      </button>
    </div>

  {:else if screen === "palette"}
    <!-- Screen 1b: Pick your workspace -->
    <div class="relative flex flex-col items-center max-w-xs w-full animate-fade-in-up mt-4">
      <h1 class="text-display font-heading text-foreground tracking-tight text-center leading-tight">
        Pick your workspace
      </h1>
      <p class="text-[12px] text-muted text-center mt-2 leading-relaxed">
        You can change this anytime in Settings
      </p>

      <div class="grid grid-cols-4 gap-2 mt-8 w-full">
        {#each PALETTES as palette}
          <button
            onclick={() => { selectedPalette = palette.id; applyTheme(palette.id); }}
            class="flex flex-col items-center gap-1 cursor-pointer"
          >
            <div
              class="w-full h-[48px] rounded-md overflow-hidden relative transition-all duration-200"
              style="border: 2px solid {selectedPalette === palette.id ? '#7A3340' : 'transparent'};
                     box-shadow: {selectedPalette === palette.id ? '0 0 10px rgba(122,51,64,0.3)' : 'none'}"
            >
              <div style="background:{palette.surface};height:8px;width:100%"></div>
              <div class="flex items-center justify-center" style="background:{palette.bg};height:40px;padding:6px">
                <div
                  class="rounded-sm relative"
                  style="background:{palette.surface};width:80%;height:22px;border-left:2px solid {palette.accent}"
                >
                  <div
                    class="absolute rounded-full"
                    style="background:{palette.accent};width:4px;height:4px;top:4px;right:4px"
                  ></div>
                </div>
              </div>
            </div>
            <span class="font-mono text-[9px] font-medium text-foreground leading-tight">{palette.name}</span>
            <span class="font-heading italic text-[8px] text-muted -mt-0.5">{palette.vibe}</span>
            {#if palette.id === "kon"}
              <span class="font-mono text-[7px] font-medium px-1 py-px rounded-sm bg-accent text-white opacity-80 -mt-0.5">default</span>
            {/if}
          </button>
        {/each}
      </div>

      <button
        onclick={async () => {
          await setAndPersistTheme(selectedPalette);
          if (pendingPath === "byok") {
            handleByok();
          } else {
            screen = "signin";
          }
        }}
        class="w-full mt-8 py-3 text-sm font-medium text-white transition-all cursor-pointer rounded-md bg-accent hover:bg-accent-hover"
      >
        Continue
      </button>
    </div>

  {:else if screen === "signin"}
    <!-- Screen 2: Noren Pro Sign In -->
    <div class="flex flex-col gap-4 max-w-xs w-full animate-fade-in-up">
      <div class="text-center mb-2">
        <h2 class="text-heading font-heading text-foreground">Sign in to Noren Pro</h2>
        <p class="text-xs text-muted mt-1">No API key needed — we handle inference for you</p>
      </div>

      <!-- Auth mode toggle -->
      <div class="flex gap-1">
        <button
          onclick={() => { authMode = "login"; error = ""; passwordResetOpen = false; }}
          class="flex-1 px-2 py-1 text-[10px] uppercase tracking-wide cursor-pointer rounded-md
            {authMode === 'login'
              ? 'bg-secondary text-white font-medium'
              : 'bg-surface text-muted border border-border'}"
        >
          Sign in
        </button>
        <button
          onclick={() => { authMode = "signup"; error = ""; passwordResetOpen = false; }}
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

      {#if passwordResetOpen}
        <input
          type="email"
          bind:value={passwordResetEmail}
          class="px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
          placeholder="Email"
        />
        <button
          onclick={handleRequestPasswordReset}
          disabled={passwordResetLoading || !passwordResetEmail.trim()}
          class="w-full py-2 text-xs font-medium bg-surface border border-border text-foreground hover:border-secondary transition-colors cursor-pointer disabled:opacity-50 rounded-md"
        >
          {#if passwordResetLoading}<LoadingSpinner />{:else}Send reset code{/if}
        </button>
        <input
          type="text"
          bind:value={passwordResetCode}
          class="px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
          placeholder="Reset code"
          autocomplete="one-time-code"
        />
        <input
          type="password"
          bind:value={passwordResetNewPassword}
          class="px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
          placeholder="New password"
        />
        <input
          type="password"
          bind:value={passwordResetConfirmPassword}
          onkeydown={(e) => { if (e.key === "Enter") handleResetPassword(); }}
          class="px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
          placeholder="Confirm new password"
        />
        <button
          onclick={handleResetPassword}
          disabled={passwordResetLoading || !passwordResetEmail.trim() || !passwordResetCode.trim() || !passwordResetNewPassword}
          class="w-full py-2 text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50 rounded-md"
        >
          Reset password
        </button>
        {#if passwordResetMessage}
          <p class="text-[10px] text-secondary leading-relaxed">{passwordResetMessage}</p>
        {/if}
        <button
          onclick={() => { passwordResetOpen = false; error = ""; }}
          class="text-xs text-muted hover:text-secondary transition-colors cursor-pointer"
        >
          Back to sign in
        </button>
      {:else}
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
          class="w-full py-2 text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50 rounded-md"
        >
          {#if loading}
            <span class="inline-flex items-center gap-1"><LoadingSpinner /> {authMode === "signup" ? "Creating..." : "Signing in..."}</span>
          {:else}
            {authMode === "signup" ? "Create account" : "Sign in"}
          {/if}
        </button>
        {#if authMode === "login"}
          <button
            onclick={() => { passwordResetOpen = true; passwordResetEmail = email; error = ""; passwordResetMessage = ""; }}
            class="text-xs text-muted hover:text-secondary transition-colors cursor-pointer"
          >
            Forgot password?
          </button>
        {/if}
      {/if}

      <!-- Error -->
      {#if error}
        <div class="p-2 bg-tint border border-border rounded-xl text-xs text-muted leading-relaxed">
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

  {:else if screen === "otp"}
    <!-- Screen 3: OTP Verification -->
    <div class="card-hero flex flex-col gap-4 max-w-xs w-full animate-fade-in-up">
      <div class="text-center mb-2">
        <h2 class="text-heading font-heading text-foreground">Verify your email</h2>
        <p class="text-xs text-muted mt-1">
          We sent a verification code to <span class="font-medium text-foreground">{email}</span>
        </p>
      </div>

      <input
        type="text"
        bind:value={otpCode}
        onkeydown={(e) => { if (e.key === "Enter") handleVerifyOtp(); }}
        class="px-3 py-2 text-sm text-center tracking-[0.3em] border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
        placeholder="000000"
        maxlength={6}
        autocomplete="one-time-code"
      />

      <button
        onclick={handleVerifyOtp}
        disabled={otpLoading || !otpCode.trim()}
        class="w-full py-2 text-xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer disabled:opacity-50 rounded-md"
      >
        {#if otpLoading}
          <span class="inline-flex items-center gap-1"><LoadingSpinner /> Verifying...</span>
        {:else}
          Verify email
        {/if}
      </button>

      {#if otpMessage}
        <p class="text-[10px] text-secondary">{otpMessage}</p>
      {/if}

      {#if error}
        <div class="p-2 bg-tint border border-border rounded-xl text-xs text-muted leading-relaxed">
          {error}
        </div>
      {/if}

      <div class="flex items-center justify-between">
        <button
          onclick={handleResendOtp}
          disabled={resendCooldown > 0}
          class="text-[10px] transition-colors cursor-pointer {resendCooldown > 0 ? 'text-muted/50' : 'text-muted hover:text-foreground underline'}"
        >
          {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
        </button>
        <button
          onclick={() => { screen = "signin"; otpCode = ""; error = ""; otpMessage = ""; }}
          class="text-[10px] text-muted hover:text-foreground transition-colors cursor-pointer"
        >
          Back
        </button>
      </div>
    </div>

  {:else if screen === "next-steps"}
    <!-- Screen: Next Steps (post-auth) -->
    <div class="relative flex flex-col items-center max-w-xs w-full animate-fade-in-up mt-4">

      {#if nextStepsLoading}
        <div class="flex items-center gap-2">
          <LoadingSpinner />
          <span class="text-xs text-muted">Checking your profile...</span>
        </div>

      {:else if authCompleteMode === "pro" && hasExistingProfile}
        <!-- Pro with profile synced -->
        <div class="w-10 h-10 rounded-full flex items-center justify-center mb-4 relative" style="background:rgba(45,134,89,0.08)">
          <svg class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="var(--color-signal, #2D8659)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M5 13l4 4L19 7"/>
          </svg>
          <div class="absolute -inset-[3px] rounded-full border" style="border-color:rgba(45,134,89,0.1)"></div>
        </div>

        <h2 class="text-heading font-heading text-foreground text-center">Your voice profile is synced</h2>
        <p class="text-[12px] text-muted text-center mt-2 leading-relaxed">You're ready to generate in your voice.</p>

        <button
          onclick={() => oncomplete("generate")}
          class="w-full mt-8 py-3 text-sm font-medium text-white transition-all cursor-pointer rounded-md bg-accent hover:bg-accent-hover"
          style="box-shadow:0 2px 8px rgba(122,51,64,0.15)"
        >
          Start writing
        </button>

      {:else if authCompleteMode === "pro" && !hasExistingProfile}
        <!-- Pro without profile -->
        <div class="w-10 h-10 rounded-full flex items-center justify-center mb-4 relative" style="background:rgba(122,51,64,0.08)">
          <svg class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="var(--color-accent, #7A3340)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/>
            <path d="M14 13.12c0 2.38 0 6.38-1 8.88"/>
            <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/>
            <path d="M2 12a10 10 0 0 1 18-6"/>
            <path d="M2 16h.01"/>
            <path d="M21.8 16c.2-2 .131-5.354 0-6"/>
            <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/>
            <path d="M8.65 22c.21-.66.45-1.32.57-2"/>
            <path d="M9 6.8a6 6 0 0 1 9 5.2v2"/>
          </svg>
          <div class="absolute -inset-[3px] rounded-full border" style="border-color:rgba(122,51,64,0.08)"></div>
        </div>

        <h2 class="text-heading font-heading text-foreground text-center">Almost there</h2>
        <p class="text-[12px] text-muted text-center mt-2 leading-relaxed" style="max-width:260px">
          Extract your voice to get started. Your profile will sync to the extension automatically.
        </p>

        <div class="w-full flex flex-col gap-2 mt-6">
          <!-- Option: Extract on website -->
          <button
            onclick={() => window.open("https://usenoren.ai", "_blank")}
            class="w-full flex items-center gap-3 text-left cursor-pointer rounded-[10px] transition-all duration-200 hover:-translate-y-px"
            style="padding:12px 14px; background:var(--color-surface, #fff); border:1px solid rgba(30,49,72,0.08)"
          >
            <div class="shrink-0 flex items-center justify-center rounded-lg" style="width:32px;height:32px;background:rgba(122,51,64,0.08)">
              <svg class="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="var(--color-accent, #7A3340)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z"/>
              </svg>
            </div>
            <div>
              <div class="text-[12px] font-semibold" style="color:var(--color-accent, #7A3340)">Extract on usenoren.ai</div>
              <div class="text-[10px] text-muted mt-px">Works in your browser, nothing to install</div>
            </div>
          </button>

          <!-- Option: Desktop app -->
          <button
            onclick={() => window.open("https://usenoren.ai", "_blank")}
            class="w-full flex items-center gap-3 text-left cursor-pointer rounded-[10px] transition-all duration-200 hover:-translate-y-px"
            style="padding:12px 14px; background:var(--color-surface, #fff); border:1px solid rgba(30,49,72,0.08)"
          >
            <div class="shrink-0 flex items-center justify-center rounded-lg" style="width:32px;height:32px;background:rgba(30,49,72,0.03);border:1px solid rgba(30,49,72,0.08)">
              <svg class="w-[15px] h-[15px]" fill="none" viewBox="0 0 24 24" stroke="var(--color-secondary, #3B6B8A)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <path d="M8 21h8M12 17v4"/>
              </svg>
            </div>
            <div>
              <div class="text-[12px] font-semibold text-foreground">Download the desktop app</div>
              <div class="text-[10px] text-muted mt-px">macOS menu bar app with ⌘K shortcuts</div>
            </div>
          </button>
        </div>

        <button
          onclick={() => oncomplete("profile")}
          class="text-[11px] text-muted hover:text-secondary transition-colors cursor-pointer mt-4"
        >
          Or write a quick description instead
        </button>

      {:else}
        <!-- BYOK user -->
        <div class="w-10 h-10 rounded-full flex items-center justify-center mb-4" style="background:rgba(30,49,72,0.03);border:1px solid rgba(30,49,72,0.08)">
          <svg class="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="var(--color-secondary, #3B6B8A)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
            <circle cx="12" cy="7" r="4"/>
          </svg>
        </div>

        <h2 class="text-heading font-heading text-foreground text-center">You're ready to generate</h2>
        <p class="text-[12px] text-muted text-center mt-2 leading-relaxed" style="max-width:260px">
          Add a voice profile so output carries your tone.
        </p>

        <div class="w-full flex flex-col gap-2 mt-6">
          <button
            onclick={() => oncomplete("profile")}
            class="w-full py-3 text-sm font-medium text-white transition-all cursor-pointer rounded-md bg-accent hover:bg-accent-hover"
            style="box-shadow:0 2px 8px rgba(122,51,64,0.15)"
          >
            Write a quick profile
          </button>
          <button
            onclick={() => oncomplete("generate")}
            class="w-full py-2.5 text-xs font-medium text-muted transition-all cursor-pointer rounded-md"
            style="background:transparent;border:1px solid rgba(30,49,72,0.08)"
          >
            Skip for now
          </button>
        </div>

        <p class="text-[10px] text-muted text-center mt-4 leading-relaxed" style="opacity:0.65">
          Full AI extraction available on <a href="https://usenoren.ai" target="_blank" class="text-secondary" style="text-decoration:none">usenoren.ai</a> or the desktop app.
        </p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .onboarding-logo-glow {
    box-shadow: 0 0 28px rgba(59, 107, 138, 0.3), 0 0 56px rgba(59, 107, 138, 0.1);
  }

  .onboarding-thread {
    background: linear-gradient(90deg, transparent 0%, var(--color-secondary) 50%, transparent 100%);
    opacity: 0.06;
  }
</style>
