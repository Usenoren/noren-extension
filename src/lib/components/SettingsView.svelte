<script lang="ts">
  import {
    getSettings,
    setProvider,
    saveApiKey,
    removeApiKey,
    updateModel,
    updateBaseUrl,
    testConnection,
    setInferenceMode,
    norenProLogin,
    norenProSignup,
    norenProLogout,
    verifyEmail,
    resendOtp,
    getNorenProUsage,
    getSubscriptionStatus,
    createCheckout,
    openBillingPortal,
    googleOAuthInit,
    googleOAuthPoll,
    listOllamaModels,
    listClaudeModels,
    listGeminiModels,
    listOpenAIModels,
    listCustomModels,
    type SettingsInfo,
    type NorenProStatus,
    type SubscriptionStatus,
  isKeychainAvailable,
  } from "$lib/api/noren";
  import { friendlyError } from "$lib/utils/errors";
  import LoadingSpinner from "./LoadingSpinner.svelte";

  const presets = [
    { id: "claude-token", label: "Claude Token" },
    { id: "anthropic", label: "Anthropic" },
    { id: "openai", label: "OpenAI" },
    { id: "gemini", label: "Gemini" },
    { id: "ollama", label: "Ollama" },
    { id: "custom", label: "Custom" },
  ] as const;

  let settings = $state<SettingsInfo | null>(null);
  let selectedPreset = $state("anthropic");
  let modelInput = $state("");
  let baseUrlInput = $state("");
  let apiKeyInput = $state("");
  let showKey = $state(false);
  let isTesting = $state(false);
  let isSaving = $state(false);
  let testResult = $state("");
  let error = $state("");

  // Noren Pro state
  let proEmail = $state("");
  let proPassword = $state("");
  let proLoading = $state(false);
  let proStatus = $state<NorenProStatus | null>(null);
  let authMode = $state<"login" | "signup">("login");
  let googleLoading = $state(false);
  let pendingVerification = $state(false);
  let otpCode = $state("");
  let otpLoading = $state(false);
  let otpMessage = $state("");
  let resendCooldown = $state(0);

  // Subscription state
  let subscription = $state<SubscriptionStatus | null>(null);

  // Ollama model discovery
  let ollamaModels = $state<string[]>([]);
  let ollamaLoading = $state(false);

  // OpenAI model discovery
  let openaiModels = $state<{ id: string; label: string }[]>([]);
  let openaiModelsLoading = $state(false);

  // Custom model discovery
  let customModels = $state<{ id: string; label: string }[]>([]);
  let customModelsLoading = $state(false);

  // Gemini model discovery
  let geminiModels = $state<{ id: string; label: string }[]>([]);
  let geminiModelsLoading = $state(false);

  let requiresKey = $derived(settings?.provider.requiresKey ?? true);
  let isCustom = $derived(selectedPreset === "custom");
  let isOllama = $derived(selectedPreset === "ollama");
  let isClaudeToken = $derived(selectedPreset === "claude-token");
  let isAnthropicType = $derived(selectedPreset === "claude-token" || selectedPreset === "anthropic");
  let isGemini = $derived(selectedPreset === "gemini");
  let isOpenAI = $derived(selectedPreset === "openai");
  let extendedThinking = $state(false);
  let thinkingBudget = $state(10000);
  let showProSection = $state(false);
  let keychainActive = $state(false);
  let clickOpensSidepanel = $state(true);

  // Dynamic Claude model list
  let claudeModels = $state<{ id: string; label: string }[]>([]);
  let claudeModelsLoading = $state(false);

  const tiers = [
    { id: "pro", label: "Noren Pro", price: "$7", period: "/mo", desc: "Everything: extraction, inference, living profile, sync" },
  ] as const;

  $effect(() => {
    loadSettings();
  });

  async function loadSettings() {
    try {
      settings = await getSettings();
      keychainActive = await isKeychainAvailable();
      selectedPreset = settings.provider.name;
      modelInput = settings.provider.model;
      baseUrlInput = settings.provider.baseUrl;
      showProSection = settings.inference_mode === "noren_pro";

      // Load thinking settings
      const thinkingData = await chrome.storage.local.get(["extended_thinking", "thinking_budget", "click_opens_sidepanel"]);
      extendedThinking = thinkingData.extended_thinking ?? false;
      thinkingBudget = thinkingData.thinking_budget ?? 10000;
      clickOpensSidepanel = thinkingData.click_opens_sidepanel !== false;

      if (settings.provider.name === "ollama") {
        fetchOllamaModels(settings.provider.baseUrl);
      }
      if (settings.provider.name === "claude-token" && settings.has_key) {
        fetchClaudeModels();
      }
      if (settings.provider.name === "anthropic" && settings.has_key) {
        fetchClaudeModels();
      }
      if (settings.provider.name === "gemini" && settings.has_key) {
        fetchGeminiModels();
      }
      if (settings.provider.name === "openai" && settings.has_key) {
        fetchOpenAIModels();
      }
      if (settings.provider.name === "custom" && settings.provider.baseUrl) {
        fetchCustomModels(settings.provider.baseUrl);
      }

      if (settings.noren_pro_logged_in) {
        try {
          proStatus = await getNorenProUsage();
          try {
            subscription = await getSubscriptionStatus();
          } catch {
            subscription = null;
          }
        } catch {
          try {
            await norenProLogout();
            settings = await getSettings();
            showProSection = false;
          } catch { /* ignore */ }
          proStatus = null;
          subscription = null;
        }
      } else {
        proStatus = null;
        subscription = null;
      }
    } catch (e) {
      error = friendlyError(e);
    }
  }

  async function handleThinkingToggle() {
    extendedThinking = !extendedThinking;
    await chrome.storage.local.set({ extended_thinking: extendedThinking });
  }

  async function handleThinkingBudgetSave() {
    await chrome.storage.local.set({ thinking_budget: thinkingBudget });
  }

  async function handleClickBehaviorToggle() {
    clickOpensSidepanel = !clickOpensSidepanel;
    await chrome.storage.local.set({ click_opens_sidepanel: clickOpensSidepanel });
  }

  async function fetchClaudeModels() {
    claudeModelsLoading = true;
    try {
      const models = await listClaudeModels();
      claudeModels = models.map(m => ({ id: m.id, label: m.name }));
      if (claudeModels.length > 0 && !claudeModels.find(m => m.id === modelInput)) {
        modelInput = claudeModels[0].id;
        await updateModel(modelInput);
      }
    } catch {
      claudeModels = [];
    } finally {
      claudeModelsLoading = false;
    }
  }

  async function fetchCustomModels(baseUrl?: string) {
    const url = baseUrl || baseUrlInput;
    if (!url.trim()) return;
    customModelsLoading = true;
    try {
      const models = await listCustomModels(url);
      customModels = models.map(m => ({ id: m.id, label: m.name }));
      if (customModels.length > 0 && !customModels.find(m => m.id === modelInput)) {
        modelInput = customModels[0].id;
        await updateModel(modelInput);
      }
    } catch {
      customModels = [];
    } finally {
      customModelsLoading = false;
    }
  }

  async function fetchOpenAIModels() {
    openaiModelsLoading = true;
    try {
      const models = await listOpenAIModels();
      openaiModels = models.map(m => ({ id: m.id, label: m.name }));
      if (openaiModels.length > 0 && !openaiModels.find(m => m.id === modelInput)) {
        modelInput = openaiModels[0].id;
        await updateModel(modelInput);
      }
    } catch {
      openaiModels = [];
    } finally {
      openaiModelsLoading = false;
    }
  }

  async function fetchGeminiModels() {
    geminiModelsLoading = true;
    try {
      const models = await listGeminiModels();
      geminiModels = models.map(m => ({ id: m.id, label: m.name }));
      if (geminiModels.length > 0 && !geminiModels.find(m => m.id === modelInput)) {
        modelInput = geminiModels[0].id;
        await updateModel(modelInput);
      }
    } catch {
      geminiModels = [];
    } finally {
      geminiModelsLoading = false;
    }
  }

  async function fetchOllamaModels(baseUrl?: string) {
    ollamaLoading = true;
    ollamaModels = await listOllamaModels(baseUrl);
    ollamaLoading = false;

    // Auto-select first model if current model isn't available
    if (ollamaModels.length > 0 && !ollamaModels.includes(modelInput)) {
      modelInput = ollamaModels[0];
      await updateModel(modelInput);
    }
  }

  async function handleModeSwitch(mode: "byok" | "noren_pro") {
    error = "";
    try {
      await setInferenceMode(mode);
      await loadSettings();
    } catch (e) {
      error = friendlyError(e);
    }
  }

  async function handleProAuth() {
    if (!proEmail.trim() || !proPassword.trim()) return;
    proLoading = true;
    error = "";
    try {
      if (authMode === "signup") {
        await norenProSignup(proEmail.trim(), proPassword.trim());
        pendingVerification = true;
        otpMessage = "Check your email for a verification code.";
        proPassword = "";
        startResendCooldown();
      } else {
        await norenProLogin(proEmail.trim(), proPassword.trim());
        proEmail = "";
        proPassword = "";
        await handleModeSwitch("noren_pro");
      }
    } catch (e) {
      error = friendlyError(e);
    } finally {
      proLoading = false;
    }
  }

  async function handleVerifyOtp() {
    if (!otpCode.trim()) return;
    otpLoading = true;
    error = "";
    otpMessage = "";
    try {
      await verifyEmail(otpCode.trim());
      pendingVerification = false;
      otpCode = "";
      proEmail = "";
      await handleModeSwitch("noren_pro");
    } catch (e) {
      error = friendlyError(e);
    } finally {
      otpLoading = false;
    }
  }

  function startResendCooldown() {
    resendCooldown = 60;
    const interval = setInterval(() => {
      resendCooldown--;
      if (resendCooldown <= 0) clearInterval(interval);
    }, 1000);
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
            await handleModeSwitch("noren_pro");
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

  async function handleProLogout() {
    error = "";
    try {
      await norenProLogout();
      proStatus = null;
      await handleModeSwitch("byok");
    } catch (e) {
      error = friendlyError(e);
    }
  }

  async function handleUpgrade(tier: string) {
    error = "";
    try {
      const result = await createCheckout(tier);
      if (result.checkout_url === "dev://granted") {
        await loadSettings();
      } else {
        window.open(result.checkout_url, "_blank");
      }
    } catch (e) {
      error = friendlyError(e);
    }
  }

  async function handleManageBilling() {
    error = "";
    try {
      const url = await openBillingPortal();
      window.open(url, "_blank");
    } catch (e) {
      error = friendlyError(e);
    }
  }

  async function handlePresetChange(presetId: string) {
    selectedPreset = presetId;
    error = "";
    testResult = "";
    apiKeyInput = "";
    showKey = false;
    ollamaModels = [];

    if (presetId === "custom") {
      baseUrlInput = "";
      modelInput = "";
      customModels = [];
      await setProvider({ name: "custom", requiresKey: true });
      await loadSettings();
      return;
    }

    try {
      await setProvider({ name: presetId });
      await loadSettings();

      // Auto-detect models for Ollama
      if (presetId === "ollama") {
        await fetchOllamaModels();
      }
      if (presetId === "claude-token" || presetId === "anthropic") {
        await fetchClaudeModels();
      }
      if (presetId === "gemini") {
        await fetchGeminiModels();
      }
      if (presetId === "openai") {
        await fetchOpenAIModels();
      }
    } catch (e) {
      error = friendlyError(e);
    }
  }

  async function handleSaveCustom() {
    if (!baseUrlInput.trim()) return;
    error = "";
    try {
      await setProvider({
        name: "custom",
        baseUrl: baseUrlInput.trim(),
        model: modelInput.trim() || "",
        requiresKey: true,
      });
      await loadSettings();
      await fetchCustomModels(baseUrlInput.trim());
    } catch (e) {
      error = friendlyError(e);
    }
  }

  async function handleModelSave() {
    error = "";
    try {
      await updateModel(modelInput);
    } catch (e) {
      error = friendlyError(e);
    }
  }

  async function handleBaseUrlSave() {
    error = "";
    try {
      await updateBaseUrl(baseUrlInput);
    } catch (e) {
      error = friendlyError(e);
    }
  }

  async function handleSaveKey() {
    if (!apiKeyInput.trim()) return;
    isSaving = true;
    error = "";
    try {
      await saveApiKey(apiKeyInput.trim());
      apiKeyInput = "";
      showKey = false;
      await loadSettings();
    } catch (e) {
      error = friendlyError(e);
    } finally {
      isSaving = false;
    }
  }

  async function handleTestConnection() {
    isTesting = true;
    testResult = "";
    error = "";
    try {
      const key = apiKeyInput.trim() || undefined;
      const response = await testConnection(key);
      testResult = `Connected! Response: "${response}"`;
    } catch (e) {
      error = friendlyError(e);
    } finally {
      isTesting = false;
    }
  }

  async function handleRemoveKey() {
    error = "";
    try {
      await removeApiKey();
      await loadSettings();
    } catch (e) {
      error = friendlyError(e);
    }
  }
</script>

<div class="flex flex-col gap-4 h-full p-4 overflow-y-auto animate-fade-in-up">
  {#if !settings}
    <div class="flex items-center justify-center h-full">
      <LoadingSpinner />
    </div>
  {:else}
    <!-- Inference Mode Toggle -->
    <div>
      <span class="block text-xs font-medium text-muted mb-2 uppercase tracking-wide">Inference</span>
      <div class="flex gap-1">
        <button
          onclick={() => { showProSection = false; handleModeSwitch("byok"); }}
          class="flex-1 px-3 py-2 text-xs transition-colors cursor-pointer rounded-md text-center
            {!showProSection
              ? 'bg-primary text-white font-medium'
              : 'bg-surface text-muted border border-border hover:border-secondary hover:text-foreground'}"
        >
          BYOK
          <span class="block text-[10px] font-normal opacity-70 mt-0.5">Your API key</span>
        </button>
        <button
          onclick={() => { showProSection = true; if (settings?.noren_pro_logged_in) handleModeSwitch("noren_pro"); }}
          class="flex-1 px-3 py-2 text-xs transition-colors cursor-pointer rounded-md text-center
            {showProSection
              ? 'bg-secondary text-white font-medium'
              : 'bg-surface text-muted border border-border hover:border-secondary hover:text-foreground'}"
        >
          Noren Pro
          <span class="block text-[10px] font-normal opacity-70 mt-0.5">No key needed</span>
        </button>
      </div>
    </div>

    {#if showProSection}
      <!-- Noren Pro section -->
      {#if settings.noren_pro_logged_in && proStatus}
        <div class="flex flex-col gap-3">
          <div class="p-3 bg-tint border border-secondary/30 rounded-lg">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-medium text-secondary">
                {subscription?.tier === "pro" ? "Noren Pro" : "Free"}
              </span>
              <button
                onclick={handleProLogout}
                class="text-[10px] text-muted hover:text-error cursor-pointer uppercase tracking-wide"
              >
                Sign out
              </button>
            </div>
            <p class="text-[10px] text-muted">{proStatus.email}</p>

            {#if proStatus.tokens_used != null && proStatus.tokens_limit != null}
              <div class="mt-2">
                <div class="flex items-center justify-between text-[10px] text-muted mb-1">
                  <span>{proStatus.tokens_used.toLocaleString()} tokens used</span>
                  <span>{proStatus.tokens_limit.toLocaleString()} limit</span>
                </div>
                <div class="h-1.5 bg-border rounded-full overflow-hidden">
                  <div
                    class="h-full bg-secondary rounded-full transition-all"
                    style="width: {Math.min(100, (proStatus.tokens_used / proStatus.tokens_limit) * 100)}%"
                  ></div>
                </div>
                <p class="text-[10px] text-muted mt-1">
                  {proStatus.requests_this_month} requests this month
                </p>
              </div>
            {/if}

            {#if subscription?.active && subscription.cancel_at_period_end}
              <p class="text-[10px] text-warning mt-2">Cancels at end of period</p>
            {/if}
          </div>

          {#if !subscription?.active || subscription.tier === "free"}
            <div>
              <span class="block text-xs font-medium text-muted mb-2 uppercase tracking-wide">Subscription</span>
              <div class="flex flex-col gap-2">
                {#each tiers as t}
                  <button
                    onclick={() => handleUpgrade(t.id)}
                    class="flex items-center justify-between p-3 card hover:border-secondary cursor-pointer text-left"
                  >
                    <div>
                      <span class="text-xs font-medium text-foreground">{t.label}</span>
                      <span class="block text-[10px] text-muted mt-0.5">{t.desc}</span>
                    </div>
                    <span class="text-xs font-medium text-secondary">{t.price}<span class="text-[10px] text-muted font-normal">{t.period}</span></span>
                  </button>
                {/each}
              </div>
            </div>
          {:else}
            <button
              onclick={handleManageBilling}
              class="px-3 py-1.5 text-xs border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md self-start"
            >
              Manage subscription
            </button>
          {/if}
        </div>
      {:else if pendingVerification}
        <!-- OTP Verification -->
        <div class="flex flex-col gap-3">
          <div class="p-3 card border-secondary/30">
            <h3 class="text-xs font-semibold text-foreground mb-1">Verify your email</h3>
            <p class="text-[10px] text-muted">
              We sent a code to <span class="font-medium text-foreground">{proEmail}</span>.
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
            class="w-full py-2 text-xs font-medium bg-secondary text-white hover:bg-secondary/90 transition-colors cursor-pointer disabled:opacity-50 rounded-md"
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
            <div class="p-2 bg-tint border border-border rounded-lg text-xs text-muted leading-relaxed">
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
              onclick={() => { pendingVerification = false; otpCode = ""; error = ""; otpMessage = ""; }}
              class="text-[10px] text-muted hover:text-foreground transition-colors cursor-pointer"
            >
              Back
            </button>
          </div>
        </div>
      {:else}
        <!-- Login/Signup form -->
        <div class="flex flex-col gap-3">
          <div class="flex gap-1">
            <button
              onclick={() => { authMode = "login"; }}
              class="flex-1 px-2 py-1 text-[10px] uppercase tracking-wide cursor-pointer rounded-md
                {authMode === 'login'
                  ? 'bg-secondary text-white font-medium'
                  : 'bg-surface text-muted border border-border'}"
            >
              Sign in
            </button>
            <button
              onclick={() => { authMode = "signup"; }}
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
            disabled={googleLoading || proLoading}
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

          <input
            type="email"
            bind:value={proEmail}
            class="px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
            placeholder="Email"
          />
          <input
            type="password"
            bind:value={proPassword}
            onkeydown={(e) => { if (e.key === "Enter") handleProAuth(); }}
            class="px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
            placeholder="Password"
          />
          <button
            onclick={handleProAuth}
            disabled={proLoading || !proEmail.trim() || !proPassword.trim()}
            class="w-full py-2 text-xs font-medium bg-secondary text-white hover:bg-secondary/90 transition-colors cursor-pointer disabled:opacity-50 rounded-md"
          >
            {#if proLoading}
              <span class="inline-flex items-center gap-1"><LoadingSpinner /> {authMode === "signup" ? "Creating..." : "Signing in..."}</span>
            {:else}
              {authMode === "signup" ? "Create account" : "Sign in"}
            {/if}
          </button>
        </div>
      {/if}
    {:else}
      <!-- BYOK section -->
      <div>
        <span class="block text-xs font-medium text-muted mb-2 uppercase tracking-wide">Provider</span>
        <div class="flex flex-wrap gap-1">
          {#each presets as p}
            <button
              onclick={() => handlePresetChange(p.id)}
              class="px-3 py-1.5 text-xs transition-colors cursor-pointer rounded-md
                {selectedPreset === p.id
                  ? 'bg-primary text-white font-medium'
                  : 'bg-surface text-muted border border-border hover:border-secondary hover:text-foreground'}"
            >
              {p.label}
            </button>
          {/each}
        </div>
      </div>

      {#if selectedPreset === "ollama" || isCustom}
        <div>
          <span class="block text-xs font-medium text-muted mb-1.5 uppercase tracking-wide">Base URL</span>
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={baseUrlInput}
              class="flex-1 px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
              placeholder={selectedPreset === "ollama" ? "http://localhost:11434/v1" : "https://api.example.com/v1"}
            />
            <button
              onclick={isCustom ? handleSaveCustom : handleBaseUrlSave}
              class="px-3 py-1.5 text-xs border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
            >
              Save
            </button>
          </div>
        </div>
      {/if}

      <div>
        <span class="block text-xs font-medium text-muted mb-1.5 uppercase tracking-wide">Model</span>
        {#if isAnthropicType && claudeModelsLoading}
          <div class="flex items-center gap-2 text-xs text-muted">
            <LoadingSpinner /> Fetching models...
          </div>
        {:else if isAnthropicType && claudeModels.length > 0}
          <select
            bind:value={modelInput}
            onchange={handleModelSave}
            class="w-full px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
          >
            {#each claudeModels as m}
              <option value={m.id}>{m.label}</option>
            {/each}
          </select>
        {:else if isAnthropicType}
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={modelInput}
              class="flex-1 px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
              placeholder="claude-sonnet-4-6"
            />
            <button
              onclick={handleModelSave}
              class="px-3 py-1.5 text-xs border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
            >
              Save
            </button>
          </div>
        {:else if isOpenAI && openaiModelsLoading}
          <div class="flex items-center gap-2 text-xs text-muted">
            <LoadingSpinner /> Fetching models...
          </div>
        {:else if isOpenAI && openaiModels.length > 0}
          <select
            bind:value={modelInput}
            onchange={handleModelSave}
            class="w-full px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
          >
            {#each openaiModels as m}
              <option value={m.id}>{m.label}</option>
            {/each}
          </select>
        {:else if isOpenAI}
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={modelInput}
              class="flex-1 px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
              placeholder="gpt-4o"
            />
            <button
              onclick={handleModelSave}
              class="px-3 py-1.5 text-xs border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
            >
              Save
            </button>
          </div>
        {:else if isGemini && geminiModelsLoading}
          <div class="flex items-center gap-2 text-xs text-muted">
            <LoadingSpinner /> Fetching models...
          </div>
        {:else if isGemini && geminiModels.length > 0}
          <select
            bind:value={modelInput}
            onchange={handleModelSave}
            class="w-full px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
          >
            {#each geminiModels as m}
              <option value={m.id}>{m.label}</option>
            {/each}
          </select>
        {:else if isGemini}
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={modelInput}
              class="flex-1 px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
              placeholder="gemini-2.0-flash"
            />
            <button
              onclick={handleModelSave}
              class="px-3 py-1.5 text-xs border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
            >
              Save
            </button>
          </div>
        {:else if isCustom && customModelsLoading}
          <div class="flex items-center gap-2 text-xs text-muted">
            <LoadingSpinner /> Fetching models...
          </div>
        {:else if isCustom && customModels.length > 0}
          <select
            bind:value={modelInput}
            onchange={handleModelSave}
            class="w-full px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
          >
            {#each customModels as m}
              <option value={m.id}>{m.label}</option>
            {/each}
          </select>
        {:else if isOllama && ollamaLoading}
          <div class="flex items-center gap-2 text-xs text-muted">
            <LoadingSpinner /> Detecting models...
          </div>
        {:else if isOllama && ollamaModels.length > 0}
          <select
            bind:value={modelInput}
            onchange={handleModelSave}
            class="w-full px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
          >
            {#each ollamaModels as m}
              <option value={m}>{m}</option>
            {/each}
          </select>
        {:else}
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={modelInput}
              class="flex-1 px-3 py-1.5 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
              placeholder="Model ID"
            />
            <button
              onclick={handleModelSave}
              class="px-3 py-1.5 text-xs border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground rounded-md"
            >
              Save
            </button>
          </div>
          {#if isOllama}
            <p class="text-[10px] text-warning mt-1">Could not detect models. Is Ollama running?</p>
          {/if}
        {/if}
      </div>

      {#if isAnthropicType}
        <div>
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-muted uppercase tracking-wide">Extended Thinking</span>
            <button
              onclick={handleThinkingToggle}
              class="relative w-9 h-5 rounded-full transition-colors cursor-pointer {extendedThinking ? 'bg-secondary' : 'bg-border'}"
            >
              <span class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform {extendedThinking ? 'translate-x-4' : ''}"></span>
            </button>
          </div>
          {#if extendedThinking}
            <div class="flex items-center gap-2 mt-2">
              <span class="text-[10px] text-muted whitespace-nowrap">Budget:</span>
              <select
                bind:value={thinkingBudget}
                onchange={handleThinkingBudgetSave}
                class="flex-1 px-2 py-1 text-[10px] border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
              >
                <option value={5000}>5k tokens (fast)</option>
                <option value={10000}>10k tokens</option>
                <option value={25000}>25k tokens</option>
                <option value={50000}>50k tokens (deep)</option>
              </select>
            </div>
          {/if}
          <p class="text-[10px] text-muted mt-1.5">
            {extendedThinking ? "Model will reason step-by-step before responding. Slower but higher quality." : "Direct responses without chain-of-thought reasoning."}
          </p>
        </div>
      {/if}

      {#if requiresKey}
        <div>
          {#if isClaudeToken}
            <p class="text-[10px] text-muted mb-2 leading-relaxed">
              Run <code class="bg-surface px-1 py-0.5 rounded text-foreground">claude setup-token</code> in your terminal, then paste the token below.
            </p>
          {/if}
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs font-medium text-muted uppercase tracking-wide">
              {isClaudeToken ? "Setup Token" : "API Key"}
              <span class="ml-1.5 text-[10px] font-normal normal-case tracking-normal {settings.has_key ? 'text-signal' : 'text-muted'}">
                {#if settings.has_key && keychainActive}
                  Keychain
                {:else if settings.has_key}
                  Stored
                {:else}
                  Not set
                {/if}
              </span>
            </span>
            {#if settings.has_key}
              <button
                onclick={handleRemoveKey}
                class="text-[10px] text-error hover:text-foreground cursor-pointer uppercase tracking-wide"
              >
                Remove
              </button>
            {/if}
          </div>

          <div class="flex gap-2">
            <div class="relative flex-1">
              <input
                type={showKey ? "text" : "password"}
                bind:value={apiKeyInput}
                class="w-full px-3 py-1.5 pr-12 text-xs border border-border bg-surface text-foreground rounded-md focus:outline-none focus:border-secondary"
                placeholder={isClaudeToken
                  ? (settings.has_key ? "Paste new token to replace" : "sk-ant-oat01-...")
                  : (settings.has_key ? "Enter new key to replace" : "Enter API key")}
              />
              <button
                onclick={() => { showKey = !showKey; }}
                class="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted hover:text-secondary cursor-pointer uppercase"
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {#if apiKeyInput.trim()}
            <div class="flex gap-2 mt-2">
              <button
                onclick={handleTestConnection}
                disabled={isTesting}
                class="px-3 py-1.5 text-xs border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground disabled:opacity-50 rounded-md"
              >
                {#if isTesting}
                  <span class="inline-flex items-center gap-1"><LoadingSpinner /> Testing</span>
                {:else}
                  Test
                {/if}
              </button>
              <button
                onclick={handleSaveKey}
                disabled={isSaving}
                class="px-3 py-1.5 text-xs bg-primary text-white hover:bg-primary-hover transition-colors cursor-pointer disabled:opacity-50 rounded-md font-medium"
              >
                {isSaving ? "Saving..." : isClaudeToken ? "Save Token" : "Save Key"}
              </button>
            </div>
          {/if}
        </div>
      {:else}
        <div class="p-2 bg-tint border border-border rounded-lg">
          <p class="text-xs text-muted">
            No API key needed — {settings.provider.name} runs locally.
          </p>
        </div>
      {/if}

      {#if !requiresKey || (settings.has_key && !apiKeyInput.trim())}
        <button
          onclick={handleTestConnection}
          disabled={isTesting}
          class="px-3 py-1.5 text-xs border border-border hover:border-secondary transition-colors cursor-pointer text-muted hover:text-foreground disabled:opacity-50 rounded-md self-start"
        >
          {#if isTesting}
            <span class="inline-flex items-center gap-1"><LoadingSpinner /> Testing</span>
          {:else}
            Test Connection
          {/if}
        </button>
      {/if}
    {/if}

    <!-- Test result -->
    {#if testResult}
      <div class="p-2 bg-tint border border-signal/30 rounded-lg text-xs text-signal">
        {testResult}
      </div>
    {/if}

    <!-- Error -->
    {#if error}
      <div class="p-2 bg-tint border border-border rounded-lg text-xs text-muted leading-relaxed">
        {error}
      </div>
    {/if}

    <!-- Click Behavior -->
    <div>
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-muted uppercase tracking-wide">Click Opens</span>
        <div class="flex items-center gap-2">
          <span class="text-[10px] text-muted">{clickOpensSidepanel ? "Side Panel" : "Popup"}</span>
          <button
            onclick={handleClickBehaviorToggle}
            class="relative w-9 h-5 rounded-full transition-colors cursor-pointer {clickOpensSidepanel ? 'bg-secondary' : 'bg-border'}"
          >
            <span class="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform {clickOpensSidepanel ? 'translate-x-4' : ''}"></span>
          </button>
        </div>
      </div>
      <p class="text-[10px] text-muted mt-1.5">
        {clickOpensSidepanel ? "Clicking the icon opens Noren in the side panel." : "Clicking the icon opens Noren as a popup."}
      </p>
    </div>

    <!-- Info -->
    <div class="mt-auto">
      <div class="divider"></div>
      <p class="text-[10px] text-muted leading-relaxed pt-3">
        {#if showProSection}
          Noren Pro handles inference on our servers. No API key needed. Usage resets monthly.
        {:else}
          {#if keychainActive}
            API keys are secured in your macOS Keychain via the Noren desktop app.
          {:else}
            API keys are stored in browser local storage. Install the <strong>Noren desktop app</strong> for Keychain-level security.
          {/if}
          Any OpenAI-compatible provider works — Groq, Together, Mistral, OpenRouter, LM Studio, and more.
        {/if}
      </p>
    </div>
  {/if}
</div>
