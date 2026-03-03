const API_BASE = "https://api.noren.ink/v1";

// ============================================================
// Types — reused from desktop tauri.ts
// ============================================================

export interface GenerateResult {
  text: string;
  input_tokens: number;
  output_tokens: number;
}

export interface ProviderConfig {
  name: string;
  type: "anthropic" | "openai_compatible";
  baseUrl: string;
  model: string;
  requiresKey: boolean;
}

export interface SettingsInfo {
  provider: ProviderConfig;
  has_key: boolean;
  inference_mode: "byok" | "noren_pro";
  noren_pro_logged_in: boolean;
}

export interface NorenProStatus {
  logged_in: boolean;
  email: string | null;
  inference_mode: string;
  tokens_used: number | null;
  tokens_limit: number | null;
  requests_this_month: number | null;
}

export interface SubscriptionStatus {
  tier: "free" | "pro" | "teams";
  active: boolean;
  can_extract: boolean;
  can_generate_bundled: boolean;
  can_living_profile: boolean;
  can_sync: boolean;
  can_export: boolean;
  tokens_limit: number;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  one_time_purchases: string[];
}

export interface CheckoutResult {
  checkout_url: string;
  session_id: string;
}

export interface ComparisonResult {
  with_voice: GenerateResult;
  without_voice: GenerateResult;
}

export interface ProfileOverview {
  exists: boolean;
  formats: string[];
  is_server?: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface Conversation {
  id: string;
  title: string;
  format: string;
  created_at: string;
  updated_at: string;
  total_tokens: number;
  messages: ChatMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  format: string;
  updated_at: string;
  message_count: number;
  total_tokens: number;
}

export interface GoogleOAuthInitResult {
  auth_url: string;
  session_id: string;
}

export interface GoogleOAuthPollResult {
  status: string;
  complete: boolean;
}

// ============================================================
// Storage helpers
// ============================================================

async function getAuthToken(): Promise<string | null> {
  const result = await chrome.storage.local.get("auth_token");
  return result.auth_token || null;
}

async function getRefreshToken(): Promise<string | null> {
  const result = await chrome.storage.local.get("refresh_token");
  return result.refresh_token || null;
}

async function setTokens(access: string, refresh: string): Promise<void> {
  await chrome.storage.local.set({ auth_token: access, refresh_token: refresh });
}

async function clearTokens(): Promise<void> {
  await chrome.storage.local.remove(["auth_token", "refresh_token"]);
}

async function getApiKey(): Promise<string | null> {
  const result = await chrome.storage.local.get("api_key");
  return result.api_key || null;
}

// ============================================================
// Fetch wrapper with auth
// ============================================================

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // Handle token refresh on 401
  if (res.status === 401 && token) {
    const refreshToken = await getRefreshToken();
    if (refreshToken) {
      const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (refreshRes.ok) {
        const data = await refreshRes.json();
        await setTokens(data.access_token, data.refresh_token);
        headers["Authorization"] = `Bearer ${data.access_token}`;
        return fetch(`${API_BASE}${path}`, { ...options, headers });
      } else {
        await clearTokens();
      }
    }
  }

  return res;
}

async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

// ============================================================
// Provider presets
// ============================================================

const PROVIDER_PRESETS: Record<string, ProviderConfig> = {
  anthropic: {
    name: "anthropic",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-20250514",
    requiresKey: true,
  },
  openai: {
    name: "openai",
    type: "openai_compatible",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    requiresKey: true,
  },
  gemini: {
    name: "gemini",
    type: "openai_compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.0-flash",
    requiresKey: true,
  },
  ollama: {
    name: "ollama",
    type: "openai_compatible",
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
    requiresKey: false,
  },
};

// ============================================================
// Settings (chrome.storage.sync)
// ============================================================

export async function getSettings(): Promise<SettingsInfo> {
  const data = await chrome.storage.sync.get([
    "provider_name", "provider_type", "provider_base_url", "provider_model", "provider_requires_key",
    "inference_mode",
  ]);
  const token = await getAuthToken();
  const apiKey = await getApiKey();

  const providerName = data.provider_name || "anthropic";
  const preset = PROVIDER_PRESETS[providerName];

  return {
    provider: preset ? {
      ...preset,
      model: data.provider_model || preset.model,
      baseUrl: data.provider_base_url || preset.baseUrl,
    } : {
      name: data.provider_name || "custom",
      type: data.provider_type || "openai_compatible",
      baseUrl: data.provider_base_url || "",
      model: data.provider_model || "",
      requiresKey: data.provider_requires_key ?? true,
    },
    has_key: !!apiKey,
    inference_mode: data.inference_mode || "byok",
    noren_pro_logged_in: !!token,
  };
}

export async function setProvider(provider: {
  name: string;
  type?: string;
  baseUrl?: string;
  model?: string;
  requiresKey?: boolean;
}): Promise<void> {
  const preset = PROVIDER_PRESETS[provider.name];
  const data: Record<string, unknown> = { provider_name: provider.name };

  if (preset) {
    data.provider_type = preset.type;
    data.provider_base_url = provider.baseUrl || preset.baseUrl;
    data.provider_model = provider.model || preset.model;
    data.provider_requires_key = preset.requiresKey;
  } else {
    data.provider_type = provider.type || "openai_compatible";
    data.provider_base_url = provider.baseUrl || "";
    data.provider_model = provider.model || "";
    data.provider_requires_key = provider.requiresKey ?? true;
  }

  await chrome.storage.sync.set(data);
}

export async function saveApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ api_key: key });
}

export async function removeApiKey(): Promise<void> {
  await chrome.storage.local.remove("api_key");
}

export async function updateModel(model: string): Promise<void> {
  await chrome.storage.sync.set({ provider_model: model });
}

export async function updateBaseUrl(baseUrl: string): Promise<void> {
  await chrome.storage.sync.set({ provider_base_url: baseUrl });
}

export async function setInferenceMode(mode: "byok" | "noren_pro"): Promise<void> {
  await chrome.storage.sync.set({ inference_mode: mode });
}

// ============================================================
// BYOK — Direct provider calls
// ============================================================

async function byokGenerate(params: {
  prompt: string;
  format: string;
  level: string;
  context?: string;
  attachments?: string[];
  systemPrompt?: string;
}): Promise<GenerateResult> {
  const settings = await getSettings();
  const apiKey = await getApiKey();

  // Build system message with voice profile context
  let system = params.systemPrompt || "You are a helpful writing assistant. Match the user's voice and style.";
  if (params.context) {
    system += `\n\nContext from the user's current document:\n${params.context}`;
  }

  // Build user message
  let userContent = params.prompt;
  if (params.attachments?.length) {
    const parts = params.attachments.map((att, i) => `[Attached file ${i + 1}]\n${att}`);
    parts.push(params.prompt);
    userContent = parts.join("\n\n");
  }

  if (params.format !== "general") {
    userContent = `[Format: ${params.format}] [Enforcement: ${params.level}]\n\n${userContent}`;
  }

  if (settings.provider.type === "anthropic") {
    return byokAnthropic(settings.provider, apiKey, system, userContent);
  }
  return byokOpenAI(settings.provider, apiKey, system, userContent);
}

async function byokAnthropic(
  provider: ProviderConfig,
  apiKey: string | null,
  system: string,
  userContent: string,
): Promise<GenerateResult> {
  const res = await fetch(`${provider.baseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey || "",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Anthropic HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    text: data.content?.[0]?.text || "",
    input_tokens: data.usage?.input_tokens || 0,
    output_tokens: data.usage?.output_tokens || 0,
  };
}

async function byokOpenAI(
  provider: ProviderConfig,
  apiKey: string | null,
  system: string,
  userContent: string,
): Promise<GenerateResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 4096,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || "",
    input_tokens: data.usage?.prompt_tokens || 0,
    output_tokens: data.usage?.completion_tokens || 0,
  };
}

async function byokChat(
  messages: ChatMessage[],
  format: string,
  attachments?: string[],
): Promise<GenerateResult> {
  const settings = await getSettings();
  const apiKey = await getApiKey();

  let system = "You are a helpful writing assistant. Match the user's voice and style.";
  if (format !== "general") {
    system += `\n[Format: ${format}]`;
  }

  // Inject attachments into last user message
  const processed = messages.map((m, i) => {
    if (i === messages.length - 1 && m.role === "user" && attachments?.length) {
      const parts = attachments.map((att, j) => `[Attached file ${j + 1}]\n${att}`);
      parts.push(m.content);
      return { ...m, content: parts.join("\n\n") };
    }
    return m;
  });

  if (settings.provider.type === "anthropic") {
    const res = await fetch(`${settings.provider.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey || "",
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: settings.provider.model,
        max_tokens: 4096,
        system,
        messages: processed,
      }),
    });
    if (!res.ok) throw new Error(await res.text() || `Anthropic HTTP ${res.status}`);
    const data = await res.json();
    return {
      text: data.content?.[0]?.text || "",
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    };
  }

  // OpenAI-compatible
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const res = await fetch(`${settings.provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: settings.provider.model,
      max_tokens: 4096,
      messages: [{ role: "system", content: system }, ...processed],
    }),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content || "",
    input_tokens: data.usage?.prompt_tokens || 0,
    output_tokens: data.usage?.completion_tokens || 0,
  };
}

// ============================================================
// Generate — routes to BYOK or Pro
// ============================================================

export async function generate(params: {
  prompt: string;
  format: string;
  level: string;
  context?: string;
  attachments?: string[];
}): Promise<GenerateResult> {
  const settings = await getSettings();

  if (settings.inference_mode === "noren_pro" && settings.noren_pro_logged_in) {
    return apiJson<GenerateResult>("/generate", {
      method: "POST",
      body: JSON.stringify({
        prompt: params.prompt,
        format: params.format,
        level: params.level,
        context: params.context,
        attachments: params.attachments,
      }),
    });
  }

  return byokGenerate(params);
}

export async function generateComparison(params: {
  prompt: string;
  format: string;
  context?: string;
  attachments?: string[];
}): Promise<ComparisonResult> {
  // Comparison only available via Pro
  return apiJson<ComparisonResult>("/generate", {
    method: "POST",
    body: JSON.stringify({
      ...params,
      compare: true,
    }),
  });
}

// ============================================================
// Chat — routes to BYOK or Pro
// ============================================================

export async function chatSend(params: {
  messages: ChatMessage[];
  format: string;
  attachments?: string[];
}): Promise<GenerateResult> {
  const settings = await getSettings();

  if (settings.inference_mode === "noren_pro" && settings.noren_pro_logged_in) {
    return apiJson<GenerateResult>("/generate", {
      method: "POST",
      body: JSON.stringify({
        messages: params.messages,
        format: params.format,
        attachments: params.attachments,
        mode: "chat",
      }),
    });
  }

  return byokChat(params.messages, params.format, params.attachments);
}

// ============================================================
// Chat history — chrome.storage.local
// ============================================================

export async function saveChat(conversation: Conversation): Promise<void> {
  await chrome.storage.local.set({ [`chat_${conversation.id}`]: conversation });
}

export async function listChats(): Promise<ConversationSummary[]> {
  const all = await chrome.storage.local.get(null);
  const chats: ConversationSummary[] = [];

  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith("chat_") && value && typeof value === "object") {
      const conv = value as Conversation;
      chats.push({
        id: conv.id,
        title: conv.title,
        format: conv.format,
        updated_at: conv.updated_at,
        message_count: conv.messages.length,
        total_tokens: conv.total_tokens,
      });
    }
  }

  return chats.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function loadChat(id: string): Promise<Conversation> {
  const result = await chrome.storage.local.get(`chat_${id}`);
  const conv = result[`chat_${id}`];
  if (!conv) throw new Error("Chat not found");
  return conv as Conversation;
}

export async function deleteChat(id: string): Promise<void> {
  await chrome.storage.local.remove(`chat_${id}`);
}

// ============================================================
// Profile overview — routes to Pro API
// ============================================================

export async function getProfileOverview(): Promise<ProfileOverview> {
  const settings = await getSettings();

  if (settings.inference_mode === "noren_pro" && settings.noren_pro_logged_in) {
    try {
      const meta = await apiJson<{ exists: boolean; formats: string[]; is_server?: boolean }>(
        "/profile/voice/metadata"
      );
      return meta;
    } catch {
      return { exists: false, formats: [] };
    }
  }

  // BYOK — no server profile, just return empty
  return { exists: false, formats: [] };
}

export async function listFormats(): Promise<string[]> {
  const overview = await getProfileOverview();
  return overview.formats;
}

// ============================================================
// Auth — Noren Pro
// ============================================================

export async function norenProLogin(email: string, password: string): Promise<NorenProStatus> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  const data = await res.json();
  await setTokens(data.access_token, data.refresh_token);
  await setInferenceMode("noren_pro");
  return { logged_in: true, email, inference_mode: "noren_pro", tokens_used: null, tokens_limit: null, requests_this_month: null };
}

export async function norenProSignup(email: string, password: string): Promise<NorenProStatus> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  const data = await res.json();
  await setTokens(data.access_token, data.refresh_token);
  await setInferenceMode("noren_pro");
  return { logged_in: true, email, inference_mode: "noren_pro", tokens_used: null, tokens_limit: null, requests_this_month: null };
}

export async function norenProLogout(): Promise<void> {
  await clearTokens();
  await setInferenceMode("byok");
}

export async function getNorenProUsage(): Promise<NorenProStatus> {
  const data = await apiJson<{
    email: string;
    tokens_used: number;
    tokens_limit: number;
    requests_this_month: number;
  }>("/generate/usage");
  return {
    logged_in: true,
    email: data.email,
    inference_mode: "noren_pro",
    tokens_used: data.tokens_used,
    tokens_limit: data.tokens_limit,
    requests_this_month: data.requests_this_month,
  };
}

export async function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  return apiJson<SubscriptionStatus>("/billing/status");
}

export async function createCheckout(tier: string): Promise<CheckoutResult> {
  return apiJson<CheckoutResult>("/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ tier }),
  });
}

export async function openBillingPortal(): Promise<string> {
  const data = await apiJson<{ url: string }>("/billing/portal", { method: "POST" });
  return data.url;
}

// ============================================================
// Google OAuth
// ============================================================

export async function googleOAuthInit(): Promise<GoogleOAuthInitResult> {
  return apiJson<GoogleOAuthInitResult>("/auth/google/init", { method: "POST" });
}

export async function googleOAuthPoll(sessionId: string): Promise<GoogleOAuthPollResult> {
  const res = await fetch(`${API_BASE}/auth/google/poll?session_id=${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  const data = await res.json();

  // If complete, store the tokens
  if (data.complete && data.access_token) {
    await setTokens(data.access_token, data.refresh_token);
    await setInferenceMode("noren_pro");
  }

  return { status: data.status, complete: data.complete };
}

// ============================================================
// Test connection
// ============================================================

export async function testConnection(key?: string): Promise<string> {
  const settings = await getSettings();
  const testKey = key || await getApiKey();

  // Quick test: send a minimal request to the provider
  const testPrompt = "Say 'hello' in one word.";

  if (settings.provider.type === "anthropic") {
    const result = await byokAnthropic(
      settings.provider,
      testKey,
      "Respond in exactly one word.",
      testPrompt,
    );
    return result.text;
  }

  const result = await byokOpenAI(
    settings.provider,
    testKey,
    "Respond in exactly one word.",
    testPrompt,
  );
  return result.text;
}

// ============================================================
// Context text — from content script via messaging
// ============================================================

export async function getContextText(): Promise<string | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return null;

    const response = await chrome.tabs.sendMessage(tab.id, { type: "get-selection" });
    return response?.text || null;
  } catch {
    return null;
  }
}

// ============================================================
// Inject text — via content script
// ============================================================

export async function injectGeneratedText(text: string): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");

  await chrome.tabs.sendMessage(tab.id, { type: "inject-text", text });
}
