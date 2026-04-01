<script lang="ts">
  import { PALETTES, getTheme, setAndPersistTheme, type PaletteId } from "$lib/stores/theme.svelte";
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
  let showAuthForm = $state(false); // UI-only: shows auth form for non-logged-in users
  let keychainActive = $state(false);
  let clickOpensSidepanel = $state(true);
  let selectedTheme = $state<PaletteId>(getTheme());

  // Dynamic Claude model list
  let claudeModels = $state<{ id: string; label: string }[]>([]);
  let claudeModelsLoading = $state(false);

  // Pro section shows when logged in. No manual toggle.
  let showProSection = $derived(settings?.noren_pro_logged_in === true);

  // Tier helpers
  let hasInference = $derived((proStatus?.generations_limit ?? 0) > 0);
  let isTrial = $derived(subscription?.is_trial === true);
  let isProPaid = $derived(subscription?.tier === "pro" && !subscription?.is_trial);
  let isFree = $derived(!isTrial && !isProPaid);

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

  async function fetchOllamaModels(baseUrl?: string) {
    ollamaLoading = true;
    try {
      ollamaModels = await listOllamaModels(baseUrl);
    } catch {
      ollamaModels = [];
    }
    ollamaLoading = false;
    if (ollamaModels.length > 0 && !ollamaModels.includes(modelInput)) {
      modelInput = ollamaModels[0];
      await updateModel(modelInput);
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

  async function handleModeSwitch(mode: string) {
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
      subscription = null;
      await handleModeSwitch("byok");
    } catch (e) {
      error = friendlyError(e);
    }
  }

  async function handleUpgrade(tier: string) {
    error = "";
    try {
      const result = await createCheckout(tier);
      if (result.checkout_url !== "dev://granted") {
        window.open(result.checkout_url, "_blank");
      } else {
        await loadSettings();
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
      if (presetId === "ollama") await fetchOllamaModels();
      if (presetId === "claude-token" || presetId === "anthropic") await fetchClaudeModels();
      if (presetId === "gemini") await fetchGeminiModels();
      if (presetId === "openai") await fetchOpenAIModels();
    } catch (e) {
      error = friendlyError(e);
    }
  }

  async function handleSaveCustom() {
    if (!baseUrlInput.trim()) return;
    error = "";
    try {
      await setProvider({ name: "custom", baseUrl: baseUrlInput.trim(), model: modelInput.trim() || "", requiresKey: true });
      await loadSettings();
      await fetchCustomModels(baseUrlInput.trim());
    } catch (e) {
      error = friendlyError(e);
    }
  }

  async function handleModelSave() {
    error = "";
    try { await updateModel(modelInput); } catch (e) { error = friendlyError(e); }
  }

  async function handleBaseUrlSave() {
    error = "";
    try { await updateBaseUrl(baseUrlInput); } catch (e) { error = friendlyError(e); }
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
    try { await removeApiKey(); await loadSettings(); } catch (e) { error = friendlyError(e); }
  }

  function trialDaysLeft(): number | null {
    if (!subscription?.trial_expires_at) return null;
    const diff = new Date(subscription.trial_expires_at).getTime() - Date.now();
    if (diff <= 0) return 0;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }
</script>

<div class="sv-page animate-fade-in-up">
  {#if !settings}
    <div class="flex items-center justify-center" style="min-height: 200px;">
      <LoadingSpinner />
    </div>
  {:else}
    <!-- Identity strip (logged in only) -->
    {#if settings.noren_pro_logged_in && proStatus}
      <div class="sv-identity">
        <div class="sv-avatar">{(proStatus.email?.[0] || "N").toUpperCase()}</div>
        <div class="sv-identity-info">
          <div class="sv-email">{proStatus.email}</div>
          <div class="sv-tier" class:sv-tier-pro={isProPaid} class:sv-tier-trial={isTrial} class:sv-tier-free={isFree}>
            {isTrial ? "Trial" : isProPaid ? "Pro" : "Free"}
          </div>
        </div>
        <button class="sv-signout" onclick={handleProLogout}>Sign out</button>
      </div>
    {/if}

    <!-- Mode strip (only for non-logged-in users to access auth form) -->
    {#if !settings.noren_pro_logged_in}
      <div class="sv-mode-strip">
        <button
          class="sv-mode-btn"
          class:on={!showAuthForm}
          class:on-byok={!showAuthForm}
          onclick={() => { showAuthForm = false; }}
        >BYOK<span class="sv-mode-sub">Your API key</span></button>
        <button
          class="sv-mode-btn"
          class:on={showAuthForm}
          class:on-pro={showAuthForm}
          onclick={() => { showAuthForm = true; }}
        >Noren Pro<span class="sv-mode-sub">No key needed</span></button>
      </div>
    {/if}

    <!-- Trial banner -->
    {#if showProSection && isTrial}
      {@const days = trialDaysLeft()}
      <div class="sv-trial-banner">
        <span class="sv-trial-text">
          {#if days != null && days <= 3}
            Trial ends in {days === 0 ? "less than a day" : days === 1 ? "1 day" : `${days} days`}
          {:else if subscription?.trial_expires_at}
            Trial until {formatDate(subscription.trial_expires_at)}
          {:else}
            Active trial
          {/if}
        </span>
        <button class="sv-trial-cta" onclick={() => handleUpgrade("pro")}>Upgrade</button>
      </div>
    {/if}

    <!-- Cancel notice -->
    {#if settings?.noren_pro_logged_in && subscription?.active && subscription.cancel_at_period_end}
      <div class="sv-cancel-notice">
        Cancels at end of period{subscription.current_period_end ? ` (${formatDate(subscription.current_period_end)})` : ""}
      </div>
    {/if}

    <!-- Free tier banners (show whenever logged in as free, regardless of mode tab) -->
    {#if settings.noren_pro_logged_in && isFree && !isTrial}
      <div class="sv-no-inference">No bundled inference on Free. Subscribe to Pro or switch to BYOK.</div>
      <button class="sv-upgrade-banner" onclick={() => handleUpgrade("pro")}>
        <div class="sv-upgrade-left">
          <div class="sv-upgrade-name">Upgrade to Pro</div>
          <div class="sv-upgrade-desc">Inference, extraction, living profile, sync</div>
        </div>
        <div class="sv-upgrade-price">$7<span class="sv-upgrade-per">/mo</span></div>
        <span class="sv-upgrade-arrow">&rsaquo;</span>
      </button>
    {/if}

    <div class="sv-body">
      <div class="sv-sections sv-stagger">

        {#if showProSection && proStatus}
          <!-- ═══ NOREN PRO (logged in) ═══ -->

          <!-- Usage (only if they have inference) -->
          {#if hasInference && proStatus.generations_used != null && proStatus.generations_limit != null}
            <div class="sv-section">
              <span class="section-label sv-section-label">Usage</span>
              <div class="sv-usage">
                <div class="sv-usage-row">
                  <span>{proStatus.generations_used} / {proStatus.generations_limit} generations</span>
                </div>
                <div class="sv-bar">
                  <div class="sv-bar-fill" style="width: {Math.min(100, (proStatus.generations_used / (proStatus.generations_limit || 1)) * 100)}%"></div>
                </div>
                <div class="sv-usage-meta">
                  Chat and autocomplete don't count. Resets {new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
              </div>
            </div>
          {/if}

          <!-- Subscription management (paid Pro or cancelling) -->
          {#if isProPaid || subscription?.cancel_at_period_end}
            <div class="sv-section">
              <div class="sv-row">
                <div class="sv-row-left">
                  <div class="sv-row-title">Subscription</div>
                  <div class="sv-row-desc">{subscription?.cancel_at_period_end ? "Reactivate or update payment" : "Manage billing, invoices, plan"}</div>
                </div>
                <button class="sv-btn-outline" onclick={handleManageBilling}>Manage</button>
              </div>
            </div>
          {/if}

          <!-- Subscription upsell (free tier, logged in) -->
          {#if isFree}
            <div class="sv-section">
              <span class="section-label sv-section-label">Subscription</span>
              {#each tiers as t}
                <button class="sv-sub-card card" onclick={() => handleUpgrade(t.id)}>
                  <div>
                    <span class="sv-sub-name">{t.label}</span>
                    <span class="sv-sub-desc">{t.desc}</span>
                  </div>
                  <span class="sv-sub-price">{t.price}<span class="sv-sub-per">{t.period}</span></span>
                </button>
              {/each}
            </div>
          {/if}

        {:else if pendingVerification}
          <!-- OTP Verification -->
          <div class="sv-section">
            <div class="card" style="padding: 14px; border-color: rgba(59,107,138,0.3);">
              <h3 class="text-xs font-semibold text-foreground mb-1">Verify your email</h3>
              <p class="text-[10px] text-muted">We sent a code to <span class="font-medium text-foreground">{proEmail}</span>.</p>
            </div>
          </div>
          <div class="sv-section">
            <div class="sv-stack">
              <input
                type="text"
                bind:value={otpCode}
                onkeydown={(e) => { if (e.key === "Enter") handleVerifyOtp(); }}
                class="sv-input sv-input-mono"
                placeholder="000000"
                maxlength={6}
                autocomplete="one-time-code"
              />
              <button class="sv-btn-fill sv-btn-full" onclick={handleVerifyOtp} disabled={otpLoading || !otpCode.trim()}>
                {#if otpLoading}<span class="inline-flex items-center gap-1"><LoadingSpinner /> Verifying...</span>{:else}Verify email{/if}
              </button>
              {#if otpMessage}<p class="text-[10px] text-secondary">{otpMessage}</p>{/if}
              {#if error}<div class="sv-error">{error}</div>{/if}
              <div class="flex items-center justify-between">
                <button class="sv-link-btn" onclick={handleResendOtp} disabled={resendCooldown > 0}>
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
                </button>
                <button class="sv-link-btn" onclick={() => { pendingVerification = false; otpCode = ""; error = ""; otpMessage = ""; }}>Back</button>
              </div>
            </div>
          </div>

        {:else if showAuthForm}
          <!-- Login/Signup (non-logged-in user clicked Pro tab) -->
          <div class="sv-section">
            <div class="sv-stack">
              <button class="sv-google-btn" onclick={handleGoogleSignIn} disabled={googleLoading || proLoading}>
                {#if googleLoading}
                  <LoadingSpinner /> Waiting for Google...
                {:else}
                  <svg class="sv-google-icon" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in with Google
                {/if}
              </button>
              <div class="sv-or">
                <div class="divider-thread" style="flex: 1;"></div>
                <span class="text-[9px] text-muted" style="text-transform: uppercase; letter-spacing: 0.08em;">or</span>
                <div class="divider-thread" style="flex: 1;"></div>
              </div>
              <input type="email" bind:value={proEmail} class="sv-input" placeholder="Email" />
              <input type="password" bind:value={proPassword} onkeydown={(e) => { if (e.key === "Enter") handleProAuth(); }} class="sv-input" placeholder="Password" />
              <div class="sv-auth-actions">
                <button class="sv-btn-fill sv-auth-btn" onclick={() => { authMode = "login"; handleProAuth(); }} disabled={proLoading || !proEmail.trim() || !proPassword.trim()}>
                  {#if proLoading && authMode === "login"}<LoadingSpinner />{:else}Sign in{/if}
                </button>
                <button class="sv-btn-secondary sv-auth-btn" onclick={() => { authMode = "signup"; handleProAuth(); }} disabled={proLoading || !proEmail.trim() || !proPassword.trim()}>
                  {#if proLoading && authMode === "signup"}<LoadingSpinner />{:else}Create account{/if}
                </button>
              </div>
            </div>
          </div>

        {:else}
          <!-- ═══ BYOK ═══ -->
          <div class="sv-section">
            <span class="section-label sv-section-label">Provider</span>
            <div class="sv-stack">
              <div class="sv-provider-pills">
                {#each presets as p}
                  <button class="sv-pp" class:on={selectedPreset === p.id} onclick={() => handlePresetChange(p.id)}>{p.label}</button>
                {/each}
              </div>

              <!-- Base URL (Ollama / Custom) -->
              {#if selectedPreset === "ollama" || isCustom}
                <div class="flex gap-2">
                  <input type="text" bind:value={baseUrlInput} class="sv-input" style="flex:1" placeholder={selectedPreset === "ollama" ? "http://localhost:11434/v1" : "https://api.example.com/v1"} />
                  <button class="sv-btn-outline" onclick={isCustom ? handleSaveCustom : handleBaseUrlSave}>Save</button>
                </div>
              {/if}

              <!-- Model -->
              {#if isAnthropicType && claudeModelsLoading}
                <div class="flex items-center gap-2 text-xs text-muted"><LoadingSpinner /> Fetching models...</div>
              {:else if isAnthropicType && claudeModels.length > 0}
                <select bind:value={modelInput} onchange={handleModelSave} class="sv-select">{#each claudeModels as m}<option value={m.id}>{m.label}</option>{/each}</select>
              {:else if isOpenAI && openaiModelsLoading}
                <div class="flex items-center gap-2 text-xs text-muted"><LoadingSpinner /> Fetching models...</div>
              {:else if isOpenAI && openaiModels.length > 0}
                <select bind:value={modelInput} onchange={handleModelSave} class="sv-select">{#each openaiModels as m}<option value={m.id}>{m.label}</option>{/each}</select>
              {:else if isGemini && geminiModelsLoading}
                <div class="flex items-center gap-2 text-xs text-muted"><LoadingSpinner /> Fetching models...</div>
              {:else if isGemini && geminiModels.length > 0}
                <select bind:value={modelInput} onchange={handleModelSave} class="sv-select">{#each geminiModels as m}<option value={m.id}>{m.label}</option>{/each}</select>
              {:else if isCustom && customModelsLoading}
                <div class="flex items-center gap-2 text-xs text-muted"><LoadingSpinner /> Fetching models...</div>
              {:else if isCustom && customModels.length > 0}
                <select bind:value={modelInput} onchange={handleModelSave} class="sv-select">{#each customModels as m}<option value={m.id}>{m.label}</option>{/each}</select>
              {:else if isOllama && ollamaLoading}
                <div class="flex items-center gap-2 text-xs text-muted"><LoadingSpinner /> Detecting models...</div>
              {:else if isOllama && ollamaModels.length > 0}
                <select bind:value={modelInput} onchange={handleModelSave} class="sv-select">{#each ollamaModels as m}<option value={m}>{m}</option>{/each}</select>
              {:else}
                <div class="flex gap-2">
                  <input type="text" bind:value={modelInput} class="sv-input" style="flex:1" placeholder={isAnthropicType ? "claude-sonnet-4-6" : isOpenAI ? "gpt-4o" : isGemini ? "gemini-2.0-flash" : "Model ID"} />
                  <button class="sv-btn-outline" onclick={handleModelSave}>Save</button>
                </div>
                {#if isOllama}<p class="text-[10px] text-warning">Could not detect models. Is Ollama running?</p>{/if}
              {/if}

              <!-- API Key -->
              {#if requiresKey}
                {#if isClaudeToken}
                  <p class="text-[10px] text-muted leading-relaxed">Run <code class="bg-surface px-1 py-0.5 rounded text-foreground">claude setup-token</code> then paste below.</p>
                {/if}
                <div class="sv-key-status">
                  <span class="sv-key-badge" class:active={settings.has_key}>
                    {#if settings.has_key}
                      <span class="sv-key-dot"></span>{keychainActive ? "Keychain" : "Stored"}
                    {:else}
                      Not set
                    {/if}
                  </span>
                  {#if settings.has_key}
                    <button class="sv-key-remove" onclick={handleRemoveKey}>Remove</button>
                  {/if}
                </div>
                <div class="sv-key-row">
                  <input
                    type={showKey ? "text" : "password"}
                    bind:value={apiKeyInput}
                    class="sv-input"
                    style="padding-right: 44px;"
                    placeholder={isClaudeToken ? (settings.has_key ? "Paste new token to replace" : "sk-ant-oat01-...") : (settings.has_key ? "Enter new key to replace" : "Enter API key")}
                  />
                  <button class="sv-key-show" onclick={() => { showKey = !showKey; }}>{showKey ? "Hide" : "Show"}</button>
                </div>
                {#if apiKeyInput.trim()}
                  <div class="flex gap-2">
                    <button class="sv-btn-outline" onclick={handleTestConnection} disabled={isTesting}>
                      {#if isTesting}<span class="inline-flex items-center gap-1"><LoadingSpinner /> Testing</span>{:else}Test{/if}
                    </button>
                    <button class="sv-btn-fill" onclick={handleSaveKey} disabled={isSaving}>
                      {isSaving ? "Saving..." : isClaudeToken ? "Save Token" : "Save Key"}
                    </button>
                  </div>
                {/if}
              {:else}
                <p class="text-xs text-muted">No API key needed. {settings.provider.name} runs locally.</p>
              {/if}
            </div>
          </div>

          <!-- Extended Thinking (Anthropic BYOK) -->
          {#if isAnthropicType}
            <div class="sv-section">
              <div class="sv-row">
                <div class="sv-row-left">
                  <div class="sv-row-title">Extended thinking</div>
                  <div class="sv-row-desc">{extendedThinking ? "Step-by-step reasoning. Slower but higher quality." : "Direct responses without chain-of-thought."}</div>
                </div>
                <button class="toggle {extendedThinking ? 'active' : ''}" onclick={handleThinkingToggle} aria-label="Toggle extended thinking"></button>
              </div>
              {#if extendedThinking}
                <div class="flex items-center gap-2" style="margin-top: 8px;">
                  <span class="text-[10px] text-muted whitespace-nowrap">Budget:</span>
                  <select bind:value={thinkingBudget} onchange={handleThinkingBudgetSave} class="sv-select" style="flex:1;font-size:10px;">
                    <option value={5000}>5k tokens (fast)</option>
                    <option value={10000}>10k tokens</option>
                    <option value={25000}>25k tokens</option>
                    <option value={50000}>50k tokens (deep)</option>
                  </select>
                </div>
              {/if}
            </div>
          {/if}

          <!-- Test Connection (stored key, no pending input) -->
          {#if (!requiresKey || (settings.has_key && !apiKeyInput.trim()))}
            <div class="sv-section">
              <button class="sv-btn-outline" onclick={handleTestConnection} disabled={isTesting}>
                {#if isTesting}<span class="inline-flex items-center gap-1"><LoadingSpinner /> Testing</span>{:else}Test Connection{/if}
              </button>
            </div>
          {/if}
        {/if}

        <!-- Test result / Error -->
        {#if testResult}
          <div class="sv-section"><div class="sv-result sv-result-ok">{testResult}</div></div>
        {/if}
        {#if error && !pendingVerification}
          <div class="sv-section"><div class="sv-result sv-result-err">{error}</div></div>
        {/if}

        <!-- Appearance -->
        <div class="sv-section">
          <span class="section-label sv-section-label">Appearance</span>
          <div class="sv-palette-strip">
            {#each PALETTES as palette}
              <button class="sv-ps" class:on={selectedTheme === palette.id} onclick={() => { selectedTheme = palette.id; setAndPersistTheme(palette.id); }}>
                <div class="sv-swatch" style="background: {palette.bg};">
                  <div class="sv-swatch-bar" style="background: {palette.surface}; border-bottom: 1px solid {palette.border};"></div>
                  <div class="sv-swatch-card" style="background: {palette.surface}; border: 1px solid {palette.border}; border-left: 2px solid {palette.accent};"></div>
                </div>
                <span class="sv-ps-name">{palette.name}</span>
              </button>
            {/each}
          </div>
        </div>

        <!-- Click Behavior -->
        <div class="sv-section">
          <div class="sv-row">
            <div class="sv-row-left">
              <div class="sv-row-title">Icon click</div>
              <div class="sv-row-desc">{clickOpensSidepanel ? "Opens Noren in the side panel" : "Opens Noren as a popup"}</div>
            </div>
            <div class="sv-row-right">
              <span class="sv-row-val">{clickOpensSidepanel ? "Side Panel" : "Popup"}</span>
              <button class="toggle {clickOpensSidepanel ? 'active' : ''}" onclick={handleClickBehaviorToggle} aria-label="Toggle click behavior"></button>
            </div>
          </div>
        </div>
      </div>

      <!-- Footer -->
      <div class="sv-footer">
        {#if settings?.noren_pro_logged_in && hasInference}
          Your voice runs on Noren's servers. Usage resets monthly.
        {:else if settings?.noren_pro_logged_in && isFree}
          No bundled inference on Free. Upgrade to Pro or set up a BYOK key.
        {:else if showAuthForm}
          Sign in or create an account to use Noren Pro.
        {:else}
          {#if keychainActive}
            API keys secured in macOS Keychain. Any OpenAI-compatible provider works.
          {:else}
            API keys stored locally in your browser. Any OpenAI-compatible provider works.
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* ── Page ── */
  .sv-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* ── Identity strip ── */
  .sv-identity {
    display: flex;
    align-items: center;
    padding: 14px 16px;
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
    gap: 10px;
    flex-shrink: 0;
  }
  .sv-avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, var(--color-accent), var(--color-secondary));
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: white;
    flex-shrink: 0;
  }
  .sv-identity-info { flex: 1; min-width: 0; }
  .sv-email {
    font-size: 12px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sv-tier {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 1px;
  }
  .sv-tier-pro { color: var(--color-accent); }
  .sv-tier-trial { color: var(--color-secondary); }
  .sv-tier-free { color: var(--color-muted); }
  .sv-signout {
    font-size: 10px;
    font-family: inherit;
    color: var(--color-muted);
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    transition: background 0.15s, color 0.15s;
  }
  .sv-signout:hover { background: rgba(194,59,42,0.1); color: var(--color-error); }

  /* ── Mode strip ── */
  .sv-mode-strip {
    display: flex;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border);
  }
  .sv-mode-btn {
    flex: 1;
    padding: 12px;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    text-align: center;
    cursor: pointer;
    border: none;
    position: relative;
    background: var(--color-background);
    color: var(--color-muted);
    transition: background 0.2s, color 0.2s;
    border-radius: 0;
  }
  .sv-mode-btn:first-child { border-right: 1px solid var(--color-border); }
  .sv-mode-btn:hover { color: var(--color-foreground); }
  .sv-mode-btn.on { color: var(--color-foreground); background: var(--color-surface); font-weight: 600; }
  .sv-mode-btn.on::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 20%;
    right: 20%;
    height: 2px;
    border-radius: 2px 2px 0 0;
  }
  .sv-mode-btn.on-pro::after { background: var(--color-secondary); }
  .sv-mode-btn.on-byok::after { background: var(--color-primary); }
  .sv-mode-sub {
    display: block;
    font-size: 9px;
    font-weight: 400;
    color: var(--color-muted);
    margin-top: 2px;
    opacity: 0.7;
  }

  /* ── Banners ── */
  .sv-trial-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
    background: rgba(59,107,138,0.06);
    border-bottom: 1px solid var(--color-border);
    gap: 10px;
    flex-shrink: 0;
  }
  .sv-trial-text { font-size: 11px; color: var(--color-secondary); font-weight: 500; }
  .sv-trial-cta {
    padding: 5px 12px;
    font-size: 10px;
    font-weight: 600;
    font-family: inherit;
    color: white;
    background: var(--color-accent);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s;
    white-space: nowrap;
  }
  .sv-trial-cta:hover { background: var(--color-accent-hover); }

  .sv-cancel-notice {
    padding: 10px 16px;
    border-bottom: 1px solid var(--color-border);
    font-size: 11px;
    color: var(--color-warning);
    font-weight: 500;
    flex-shrink: 0;
  }

  .sv-no-inference {
    padding: 10px 16px;
    background: var(--color-tint);
    border-bottom: 1px solid var(--color-border);
    font-size: 11px;
    color: var(--color-muted);
    line-height: 1.5;
    flex-shrink: 0;
  }

  .sv-upgrade-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: var(--color-tint);
    border: none;
    border-bottom: 1px solid var(--color-border);
    cursor: pointer;
    gap: 12px;
    flex-shrink: 0;
    width: 100%;
    text-align: left;
    font-family: inherit;
    color: var(--color-foreground);
    transition: background 0.15s;
  }
  .sv-upgrade-banner:hover { background: rgba(59,107,138,0.06); }
  .sv-upgrade-left { flex: 1; }
  .sv-upgrade-name { font-size: 12px; font-weight: 600; }
  .sv-upgrade-desc { font-size: 10px; color: var(--color-muted); margin-top: 1px; }
  .sv-upgrade-price { font-size: 14px; font-weight: 600; color: var(--color-secondary); white-space: nowrap; }
  .sv-upgrade-per { font-size: 10px; font-weight: 400; color: var(--color-muted); }
  .sv-upgrade-arrow { color: var(--color-secondary); font-size: 14px; opacity: 0.5; }

  /* ── Body (scrollable) ── */
  .sv-body {
    flex: 1;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  /* ── Sections ── */
  .sv-sections {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .sv-section {
    padding: 14px 16px;
    border-bottom: 1px solid var(--color-border);
  }
  .sv-section:last-child { border-bottom: none; }
  .sv-section-label { margin-bottom: 10px; }

  /* ── Stagger ── */
  .sv-stagger > :global(*) {
    animation: sv-enter 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .sv-stagger > :global(*:nth-child(1)) { animation-delay: 0ms; }
  .sv-stagger > :global(*:nth-child(2)) { animation-delay: 40ms; }
  .sv-stagger > :global(*:nth-child(3)) { animation-delay: 80ms; }
  .sv-stagger > :global(*:nth-child(4)) { animation-delay: 120ms; }
  .sv-stagger > :global(*:nth-child(5)) { animation-delay: 160ms; }
  .sv-stagger > :global(*:nth-child(6)) { animation-delay: 200ms; }
  .sv-stagger > :global(*:nth-child(7)) { animation-delay: 240ms; }

  @keyframes sv-enter {
    from { opacity: 0; transform: translateY(5px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── Row ── */
  .sv-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .sv-row-left { flex: 1; min-width: 0; }
  .sv-row-title { font-size: 12px; font-weight: 500; }
  .sv-row-desc { font-size: 10px; color: var(--color-muted); margin-top: 1px; }
  .sv-row-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .sv-row-val { font-size: 10px; color: var(--color-muted); }

  /* ── Usage ── */
  .sv-usage { display: flex; flex-direction: column; gap: 6px; }
  .sv-usage-row { display: flex; justify-content: space-between; font-size: 10px; color: var(--color-muted); }
  .sv-bar { height: 3px; background: var(--color-border); border-radius: 100px; overflow: hidden; }
  .sv-bar-fill {
    height: 100%;
    border-radius: 100px;
    background: linear-gradient(90deg, var(--color-accent), var(--color-secondary));
    transition: width 0.8s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .sv-usage-meta { font-size: 10px; color: var(--color-muted); }

  /* ── Palette strip ── */
  .sv-palette-strip {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: none;
  }
  .sv-palette-strip::-webkit-scrollbar { display: none; }
  .sv-ps {
    flex-shrink: 0;
    width: 52px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    background: none;
    border: none;
    padding: 0;
    transition: transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .sv-ps:hover { transform: translateY(-2px); }
  .sv-swatch {
    width: 52px;
    height: 32px;
    border-radius: 6px;
    overflow: hidden;
    border: 2px solid transparent;
    transition: border-color 0.2s, box-shadow 0.2s;
  }
  .sv-ps.on .sv-swatch {
    border-color: var(--color-accent);
    box-shadow: 0 0 10px rgba(122,51,64,0.15);
  }
  .sv-swatch-bar { height: 6px; }
  .sv-swatch-card { margin: 3px 5px; height: 10px; border-radius: 2px; }
  .sv-ps-name {
    font-family: "JetBrains Mono", monospace;
    font-size: 8px;
    color: var(--color-muted);
    text-align: center;
    white-space: nowrap;
  }

  /* ── Stack ── */
  .sv-stack { display: flex; flex-direction: column; gap: 10px; }

  /* ── Provider pills ── */
  .sv-provider-pills { display: flex; flex-wrap: wrap; gap: 4px; }
  .sv-pp {
    padding: 5px 10px;
    font-size: 11px;
    font-family: inherit;
    font-weight: 500;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-muted);
    transition: all 0.15s;
  }
  .sv-pp:hover { border-color: var(--color-muted); color: var(--color-foreground); }
  .sv-pp.on { background: var(--color-primary); color: white; border-color: var(--color-primary); }

  /* ── Inputs ── */
  .sv-input {
    width: 100%;
    padding: 8px 12px;
    font-size: 12px;
    font-family: inherit;
    color: var(--color-foreground);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    outline: none;
    transition: border-color 0.2s;
  }
  .sv-input::placeholder { color: var(--color-muted); }
  .sv-input:focus { border-color: var(--color-secondary); }
  .sv-input-mono {
    font-family: "JetBrains Mono", monospace;
    font-size: 16px;
    letter-spacing: 0.3em;
    text-align: center;
    padding: 10px;
  }

  .sv-select {
    width: 100%;
    padding: 8px 12px;
    font-size: 12px;
    font-family: inherit;
    color: var(--color-foreground);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    outline: none;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%237A746E' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
  }

  /* ── API Key ── */
  .sv-key-status { display: flex; align-items: center; justify-content: space-between; }
  .sv-key-badge {
    font-size: 9px;
    font-weight: 500;
    color: var(--color-muted);
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .sv-key-badge.active { color: var(--color-signal); }
  .sv-key-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--color-signal); }
  .sv-key-remove {
    font-size: 9px;
    color: var(--color-error);
    background: none;
    border: none;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-family: inherit;
    opacity: 0.7;
    transition: opacity 0.15s;
  }
  .sv-key-remove:hover { opacity: 1; }
  .sv-key-row { position: relative; }
  .sv-key-show {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 9px;
    color: var(--color-muted);
    background: none;
    border: none;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-family: inherit;
    transition: color 0.15s;
  }
  .sv-key-show:hover { color: var(--color-foreground); }

  /* ── Buttons ── */
  .sv-btn-fill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    color: white;
    background: var(--color-accent);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .sv-btn-fill:hover:not(:disabled) { background: var(--color-accent-hover); }
  .sv-btn-fill:disabled { opacity: 0.5; cursor: not-allowed; }
  .sv-btn-full { width: 100%; padding: 10px; }

  .sv-btn-outline {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 5px 12px;
    font-size: 11px;
    font-family: inherit;
    color: var(--color-muted);
    background: transparent;
    border: 1px solid var(--color-border);
    border-radius: 6px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }
  .sv-btn-outline:hover:not(:disabled) { border-color: var(--color-secondary); color: var(--color-foreground); }
  .sv-btn-outline:disabled { opacity: 0.5; cursor: not-allowed; }

  .sv-btn-secondary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 14px;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    color: var(--color-muted);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .sv-btn-secondary:hover:not(:disabled) { border-color: var(--color-muted); color: var(--color-foreground); }
  .sv-btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

  /* ── Auth ── */
  .sv-google-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    width: 100%;
    padding: 10px;
    font-size: 12px;
    font-weight: 500;
    font-family: inherit;
    color: var(--color-foreground);
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .sv-google-btn:hover { border-color: var(--color-secondary); }
  .sv-google-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .sv-google-icon { width: 16px; height: 16px; }

  .sv-or { display: flex; align-items: center; gap: 12px; }

  .sv-auth-actions { display: flex; gap: 4px; }
  .sv-auth-btn { flex: 1; }

  .sv-link-btn {
    font-size: 10px;
    font-family: inherit;
    color: var(--color-muted);
    background: none;
    border: none;
    cursor: pointer;
    text-decoration: underline;
    transition: color 0.15s;
  }
  .sv-link-btn:hover { color: var(--color-foreground); }
  .sv-link-btn:disabled { opacity: 0.4; text-decoration: none; cursor: not-allowed; }

  /* ── Subscription card ── */
  .sv-sub-card {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    border: 1px solid var(--color-border);
    transition: border-color 0.15s;
  }
  .sv-sub-card:hover { border-color: var(--color-secondary); }
  .sv-sub-name { font-size: 12px; font-weight: 600; display: block; }
  .sv-sub-desc { font-size: 10px; color: var(--color-muted); display: block; margin-top: 2px; }
  .sv-sub-price { font-size: 12px; font-weight: 600; color: var(--color-secondary); }
  .sv-sub-per { font-size: 10px; font-weight: 400; color: var(--color-muted); }

  /* ── Results ── */
  .sv-result {
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 11px;
    line-height: 1.5;
    animation: sv-enter 0.25s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .sv-result-ok { background: rgba(45,122,79,0.06); border: 1px solid rgba(45,122,79,0.2); color: var(--color-signal); }
  .sv-result-err { background: rgba(194,59,42,0.06); border: 1px solid rgba(194,59,42,0.2); color: var(--color-error); }

  .sv-error {
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 11px;
    background: rgba(194,59,42,0.06);
    border: 1px solid rgba(194,59,42,0.2);
    color: var(--color-error);
  }

  /* ── Footer ── */
  .sv-footer {
    padding: 12px 16px;
    font-size: 10px;
    color: var(--color-muted);
    line-height: 1.6;
    border-top: 1px solid var(--color-border);
    background: var(--color-surface);
    flex-shrink: 0;
  }
</style>
