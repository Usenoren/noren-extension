import { keychainGet, keychainStore, keychainDelete, isKeychainAvailable } from "./keychain";
export { isKeychainAvailable } from "./keychain";

const API_BASE = import.meta.env.DEV
  ? "http://localhost:8000/v1"
  : "https://api.usenoren.ai/v1";

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

export interface ProfileContent {
  core_identity: string;
  contexts: Record<string, string>;
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

export interface RefreshResponse {
  refreshed: boolean;
  sections_updated: number;
  message: string;
  observations: string[];
  history_id: string;
}

export interface ProfileMetadata {
  has_profile: boolean;
  formats: string[];
  created_at: string;
  source: string;
  last_extracted_at: string;
  extraction_count: number;
  next_refresh_available: string | null;
  can_rollback: boolean;
}

export interface RefreshHistoryEntry {
  id: string;
  diffs: SectionDiff[];
  observations: string[];
  sections_updated: number;
  edits_analyzed: number;
  samples_analyzed: number;
  generations_analyzed: number;
  rolled_back: boolean;
  created_at: string;
}

export interface SectionDiff {
  section: string;
  before: string;
  after: string;
}

export interface SyncStatus {
  has_remote: boolean;
  remote_version: number;
  updated_at: string | null;
  local_checksum: string | null;
}

export interface EditLogEntry {
  format: string;
  original: string;
  edited: string;
  app: string;
  timestamp: number;
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

async function getApiKey(providerName?: string): Promise<string | null> {
  // Try keychain first (OS-level secure storage)
  if (providerName) {
    const keychainKey = await keychainGet(providerName);
    if (keychainKey) return keychainKey;
  }
  // Fall back to chrome.storage.local
  const key = providerName ? `api_key_${providerName}` : "api_key";
  const result = await chrome.storage.local.get(key);
  return result[key]?.trim() || null;
}

// ============================================================
// Background worker fetch — bypasses CORS for claude-token
// ============================================================

async function bgFetch(url: string, init?: RequestInit): Promise<Response> {
  // If we're already in the service worker, fetch directly
  if (typeof ServiceWorkerGlobalScope !== "undefined" && self instanceof ServiceWorkerGlobalScope) {
    return fetch(url, init);
  }
  const result = await chrome.runtime.sendMessage({
    type: "proxy-fetch",
    url,
    init: { method: init?.method, headers: init?.headers, body: init?.body },
  });
  return new Response(result.text, {
    status: result.status,
    statusText: result.ok ? "OK" : "Error",
  });
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
    model: "claude-sonnet-4-6",
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
    model: "gemma3:1b",
    requiresKey: false,
  },
  "claude-token": {
    name: "claude-token",
    type: "anthropic",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
    requiresKey: true,
  },
};

// ============================================================
// Settings (chrome.storage.local)
// ============================================================

export async function getSettings(): Promise<SettingsInfo> {
  const data = await chrome.storage.local.get([
    "provider_name", "provider_type", "provider_base_url", "provider_model", "provider_requires_key",
    "inference_mode",
  ]);
  const token = await getAuthToken();
  const providerName = data.provider_name || "anthropic";
  const apiKey = await getApiKey(providerName);
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

  await chrome.storage.local.set(data);
}

// ============================================================
// Claude model discovery
// ============================================================

export async function listClaudeModels(): Promise<{ id: string; name: string }[]> {
  const settings = await getSettings();
  try {
    const isClaudeToken = settings.provider.name === "claude-token";
    const headers: Record<string, string> = { "anthropic-version": "2023-06-01" };
    if (settings.provider.requiresKey) {
      const apiKey = await getApiKey(settings.provider.name);
      if (apiKey) {
        if (isClaudeToken) {
          headers["Authorization"] = `Bearer ${apiKey}`;
          headers["anthropic-beta"] = "oauth-2025-04-20";
        } else {
          headers["x-api-key"] = apiKey;
          headers["anthropic-dangerous-direct-browser-access"] = "true";
        }
      }
    }
    const doFetch = isClaudeToken ? bgFetch : fetch;
    const res = await doFetch(`${settings.provider.baseUrl}/v1/models`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || [])
      .filter((m: { id: string }) => m.id.startsWith("claude-"))
      .map((m: { id: string; display_name?: string }) => ({
        id: m.id,
        name: m.display_name || m.id,
      }));
  } catch {
    return [];
  }
}

// ============================================================
// OpenAI model discovery
// ============================================================

export async function listOpenAIModels(): Promise<{ id: string; name: string }[]> {
  const settings = await getSettings();
  const apiKey = await getApiKey(settings.provider.name);
  if (!apiKey) return [];
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || [])
      .filter((m: { id: string; owned_by?: string }) =>
        /^(gpt-|o[1-9]|chatgpt-)/.test(m.id) && !m.id.includes("instruct") && !m.id.includes("audio") && !m.id.includes("realtime")
      )
      .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id))
      .map((m: { id: string }) => ({
        id: m.id,
        name: m.id,
      }));
  } catch {
    return [];
  }
}

// ============================================================
// Custom / OpenAI-compatible model discovery
// ============================================================

export async function listCustomModels(baseUrl: string): Promise<{ id: string; name: string }[]> {
  const settings = await getSettings();
  const apiKey = await getApiKey(settings.provider.name);
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await bgFetch(`${baseUrl.replace(/\/+$/, "")}/models`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data || [])
      .map((m: { id: string; name?: string }) => ({
        id: m.id,
        name: m.name || m.id,
      }))
      .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
}

// ============================================================
// Gemini model discovery
// ============================================================

export async function listGeminiModels(): Promise<{ id: string; name: string }[]> {
  const settings = await getSettings();
  const apiKey = await getApiKey(settings.provider.name);
  if (!apiKey) return [];
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || [])
      .filter((m: { name: string; supportedGenerationMethods?: string[] }) =>
        m.supportedGenerationMethods?.includes("generateContent") &&
        m.name.replace("models/", "").startsWith("gemini-")
      )
      .map((m: { name: string; displayName: string }) => ({
        id: m.name.replace("models/", ""),
        name: m.displayName || m.name.replace("models/", ""),
      }));
  } catch {
    return [];
  }
}

// ============================================================
// Ollama model discovery
// ============================================================

export async function listOllamaModels(baseUrl?: string): Promise<string[]> {
  const host = (baseUrl || "http://localhost:11434").replace(/\/v1\/?$/, "");
  try {
    const res = await fetch(`${host}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map((m: { name: string }) => m.name);
  } catch {
    return [];
  }
}

export async function saveApiKey(key: string): Promise<void> {
  const data = await chrome.storage.local.get("provider_name");
  const provider = data.provider_name || "anthropic";
  // Try keychain first, fall back to local storage
  const stored = await keychainStore(provider, key);
  if (stored) {
    // Remove from local storage if keychain succeeded (migrate)
    await chrome.storage.local.remove(`api_key_${provider}`);
  } else {
    await chrome.storage.local.set({ [`api_key_${provider}`]: key });
  }
}

export async function removeApiKey(): Promise<void> {
  const data = await chrome.storage.local.get("provider_name");
  const provider = data.provider_name || "anthropic";
  // Remove from both locations
  await keychainDelete(provider);
  await chrome.storage.local.remove(`api_key_${provider}`);
}

export async function updateModel(model: string): Promise<void> {
  await chrome.storage.local.set({ provider_model: model });
}

export async function updateBaseUrl(baseUrl: string): Promise<void> {
  await chrome.storage.local.set({ provider_base_url: baseUrl });
}

export async function setInferenceMode(mode: "byok" | "noren_pro"): Promise<void> {
  await chrome.storage.local.set({ inference_mode: mode });
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
  const apiKey = await getApiKey(settings.provider.name);

  // Build system message with voice profile context
  let system = params.systemPrompt || "You are a helpful writing assistant. Match the user's voice and style.";

  // Inject voice profile if available
  const voiceProfile = await getVoiceProfileText(params.format);
  if (voiceProfile) {
    system += `\n\n[Voice Profile — write in this style]:\n${voiceProfile}`;
  }

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

async function getThinkingSettings(): Promise<{ enabled: boolean; budget: number }> {
  const data = await chrome.storage.local.get(["extended_thinking", "thinking_budget"]);
  return {
    enabled: data.extended_thinking ?? false,
    budget: data.thinking_budget ?? 10000,
  };
}

async function byokAnthropic(
  provider: ProviderConfig,
  apiKey: string | null,
  system: string,
  userContent: string,
): Promise<GenerateResult> {
  const thinking = await getThinkingSettings();
  const isClaudeToken = provider.name === "claude-token";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (apiKey) {
    if (isClaudeToken) {
      headers["Authorization"] = `Bearer ${apiKey}`;
      headers["anthropic-beta"] = "oauth-2025-04-20";
    } else {
      headers["x-api-key"] = apiKey;
      headers["anthropic-dangerous-direct-browser-access"] = "true";
    }
  }

  const body: Record<string, unknown> = {
    model: provider.model,
    max_tokens: thinking.enabled ? thinking.budget + 4096 : 4096,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
  };

  if (thinking.enabled) {
    body.thinking = { type: "enabled", budget_tokens: thinking.budget };
  }

  const doFetch = isClaudeToken ? bgFetch : fetch;
  const res = await doFetch(`${provider.baseUrl}/v1/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Anthropic HTTP ${res.status}`);
  }

  const data = await res.json();
  // With thinking enabled, the text block comes after the thinking block
  const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
  return {
    text: textBlock?.text || "",
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

  const isCustom = provider.name === "custom";
  const doFetch = isCustom ? bgFetch : fetch;
  const res = await doFetch(`${provider.baseUrl}/chat/completions`, {
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
  const apiKey = await getApiKey(settings.provider.name);

  let system = "You are a helpful writing assistant. Match the user's voice and style.";

  // Inject voice profile if available
  const voiceProfile = await getVoiceProfileText(format);
  if (voiceProfile) {
    system += `\n\n[Voice Profile — write in this style]:\n${voiceProfile}`;
  }

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
    const thinking = await getThinkingSettings();
    const isClaudeToken = settings.provider.name === "claude-token";
    const chatHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    };
    if (apiKey) {
      if (isClaudeToken) {
        chatHeaders["Authorization"] = `Bearer ${apiKey}`;
        chatHeaders["anthropic-beta"] = "oauth-2025-04-20";
      } else {
        chatHeaders["x-api-key"] = apiKey;
        chatHeaders["anthropic-dangerous-direct-browser-access"] = "true";
      }
    }
    const chatBody: Record<string, unknown> = {
      model: settings.provider.model,
      max_tokens: thinking.enabled ? thinking.budget + 4096 : 4096,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: processed,
    };
    if (thinking.enabled) {
      chatBody.thinking = { type: "enabled", budget_tokens: thinking.budget };
    }
    const doChatFetch = isClaudeToken ? bgFetch : fetch;
    const res = await doChatFetch(`${settings.provider.baseUrl}/v1/messages`, {
      method: "POST",
      headers: chatHeaders,
      body: JSON.stringify(chatBody),
    });
    if (!res.ok) throw new Error(await res.text() || `Anthropic HTTP ${res.status}`);
    const data = await res.json();
    const textBlock = data.content?.find((b: { type: string }) => b.type === "text");
    return {
      text: textBlock?.text || "",
      input_tokens: data.usage?.input_tokens || 0,
      output_tokens: data.usage?.output_tokens || 0,
    };
  }

  // OpenAI-compatible
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const isCustomChat = settings.provider.name === "custom";
  const doChatFetchOAI = isCustomChat ? bgFetch : fetch;
  const res = await doChatFetchOAI(`${settings.provider.baseUrl}/chat/completions`, {
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
  mode?: "generate" | "adapt";
  context?: string;
  attachments?: string[];
}): Promise<GenerateResult> {
  const settings = await getSettings();

  if (settings.inference_mode === "noren_pro" && settings.noren_pro_logged_in) {
    const resp = await apiJson<{ content: string; input_tokens: number; output_tokens: number }>("/generate", {
      method: "POST",
      body: JSON.stringify({
        prompt: params.prompt,
        format: params.format,
        level: params.level,
        mode: params.mode || "generate",
        context: params.context,
        attachments: params.attachments,
      }),
    });
    return { text: resp.content, input_tokens: resp.input_tokens, output_tokens: resp.output_tokens };
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
// Repurpose — transform content across formats
// ============================================================

export interface RepurposeFormatResult {
  format: string;
  content: string;
  input_tokens: number;
  output_tokens: number;
  passed: boolean;
}

export interface RepurposeResult {
  results: RepurposeFormatResult[];
  total_input_tokens: number;
  total_output_tokens: number;
}

export async function repurpose(params: {
  sourceContent: string;
  sourceFormat: string;
  targetFormats?: string[];
}): Promise<RepurposeResult> {
  const settings = await getSettings();

  if (settings.inference_mode === "noren_pro" && settings.noren_pro_logged_in) {
    const resp = await apiJson<{
      results: RepurposeFormatResult[];
      total_input_tokens: number;
      total_output_tokens: number;
    }>("/repurpose", {
      method: "POST",
      body: JSON.stringify({
        source_content: params.sourceContent,
        source_format: params.sourceFormat,
        target_formats: params.targetFormats,
      }),
    });
    return resp;
  }

  return byokRepurpose(params);
}

async function byokRepurpose(params: {
  sourceContent: string;
  sourceFormat: string;
  targetFormats?: string[];
}): Promise<RepurposeResult> {
  const settings = await getSettings();
  const apiKey = await getApiKey(settings.provider.name);

  // Load voice profile
  const profile = await readProfileContent();
  const coreIdentity = profile?.core_identity || "";
  const contexts = profile?.contexts || {};

  // Resolve targets
  const FORMAT_FAMILIES = [
    ["blog", "article", "newsletter", "essay"],
    ["tweet", "thread", "twitter"],
    ["email", "slack"],
    ["linkedin", "memo"],
  ];
  const sourceFamily = FORMAT_FAMILIES.find((f) => f.includes(params.sourceFormat));
  const exclude = new Set(sourceFamily || [params.sourceFormat]);

  const targets = params.targetFormats || Object.keys(contexts).filter((k) => !exclude.has(k));

  if (targets.length === 0) {
    throw new Error("No target formats available.");
  }

  const FORMAT_MAX_TOKENS: Record<string, number> = {
    tweet: 256, twitter: 256, thread: 4096,
    email: 2048, slack: 2048, linkedin: 1024, memo: 1024,
    blog: 8192, article: 8192, essay: 8192, newsletter: 8192, longform: 8192,
  };

  // Fire all targets in parallel
  const promises = targets.map(async (target): Promise<RepurposeFormatResult> => {
    const contextLayer = contexts[target] || "";
    const system = buildRepurposeSystemPrompt(coreIdentity, contextLayer, params.sourceFormat, target);
    const maxTokens = FORMAT_MAX_TOKENS[target] || 4096;

    let result: GenerateResult;
    if (settings.provider.type === "anthropic") {
      result = await byokAnthropic(settings.provider, apiKey, system, params.sourceContent);
    } else {
      result = await byokOpenAI(settings.provider, apiKey, system, params.sourceContent);
    }

    return {
      format: target,
      content: result.text,
      input_tokens: result.input_tokens,
      output_tokens: result.output_tokens,
      passed: true,
    };
  });

  const settled = await Promise.allSettled(promises);
  const results: RepurposeFormatResult[] = [];
  for (const item of settled) {
    if (item.status === "fulfilled") results.push(item.value);
  }

  if (results.length === 0) {
    throw new Error("All target format generations failed.");
  }

  return {
    results,
    total_input_tokens: results.reduce((s, r) => s + r.input_tokens, 0),
    total_output_tokens: results.reduce((s, r) => s + r.output_tokens, 0),
  };
}

function buildRepurposeSystemPrompt(
  coreIdentity: string,
  contextLayer: string,
  sourceFormat: string,
  targetFormat: string,
): string {
  let prompt = `You are going to write as a specific person. Their voice profile is below.\n\n${coreIdentity}`;
  if (contextLayer) {
    prompt += `\n\n${contextLayer}`;
  }
  prompt += `\n\nThe user provides content originally written as a ${sourceFormat}. Transform it into ${targetFormat} content. Capture the key ideas but follow the ${targetFormat} conventions entirely. Do not preserve the source structure. Write as if creating original ${targetFormat} content about these ideas.\n\nDo not copy the example quotes from the profile into your output. Do not use the anti-pattern words listed in the profile. Follow the format conventions in the profile. Output the text only, no meta-commentary.`;
  return prompt;
}

// ============================================================
// Chat — routes to BYOK or Pro
// ============================================================

export async function chatSend(params: {
  messages: ChatMessage[];
  format: string;
  attachments?: string[];
  chatId?: string;
  chatTitle?: string;
}): Promise<GenerateResult> {
  const settings = await getSettings();

  if (settings.inference_mode === "noren_pro" && settings.noren_pro_logged_in) {
    const resp = await apiJson<{ content: string; input_tokens: number; output_tokens: number }>("/generate", {
      method: "POST",
      body: JSON.stringify({
        messages: params.messages,
        format: params.format,
        attachments: params.attachments,
        chat_id: params.chatId,
        chat_title: params.chatTitle,
      }),
    });
    return { text: resp.content, input_tokens: resp.input_tokens, output_tokens: resp.output_tokens };
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
  // Fire-and-forget: propagate delete to server for Pro users
  try {
    const settings = await getSettings();
    if (settings.inference_mode === "noren_pro" && settings.noren_pro_logged_in) {
      apiFetch(`/sync/chats/${id}`, { method: "DELETE" }).catch(() => {});
    }
  } catch { /* ignore */ }
}

// ============================================================
// Chat sync — pull remote chats from server
// ============================================================

export async function syncChatsFromServer(): Promise<number> {
  const settings = await getSettings();
  if (settings.inference_mode !== "noren_pro" || !settings.noren_pro_logged_in) return 0;

  try {
    // Get manifest of all server chats
    const manifest = await apiJson<{ chats: Array<{
      chat_id: string; title: string | null; updated_at: string;
      size_bytes: number; is_deleted: boolean;
    }>; server_time: string }>("/sync/chats/manifest");

    let synced = 0;
    for (const entry of manifest.chats) {
      if (entry.is_deleted) {
        // Remove locally if server deleted
        await chrome.storage.local.remove(`chat_${entry.chat_id}`);
        continue;
      }

      // Check if we already have this chat locally and it's up to date
      const localResult = await chrome.storage.local.get(`chat_${entry.chat_id}`);
      const local = localResult[`chat_${entry.chat_id}`] as Conversation | undefined;
      if (local && local.updated_at >= entry.updated_at) continue;

      // Download from server
      const remote = await apiJson<{
        chat_id: string; title: string | null;
        messages: Array<{ role: string; content: string }>;
        updated_at: string;
      }>(`/sync/chats/${entry.chat_id}`);

      // Save locally as a Conversation
      const conv: Conversation = {
        id: remote.chat_id,
        title: remote.title || "Untitled",
        format: "general",
        created_at: remote.updated_at,
        updated_at: remote.updated_at,
        total_tokens: 0,
        messages: remote.messages as ChatMessage[],
      };
      await chrome.storage.local.set({ [`chat_${conv.id}`]: conv });
      synced++;
    }
    return synced;
  } catch {
    return 0;
  }
}

// ============================================================
// Profile overview — routes to Pro API
// ============================================================

export async function getProfileOverview(): Promise<ProfileOverview> {
  const settings = await getSettings();

  if (settings.inference_mode === "noren_pro" && settings.noren_pro_logged_in) {
    try {
      const meta = await apiJson<{ has_profile: boolean; formats: string[] }>(
        "/profile/voice/metadata"
      );
      return { exists: meta.has_profile, formats: meta.formats, is_server: true };
    } catch {
      return { exists: false, formats: [] };
    }
  }

  // BYOK — check local profile
  const profile = await readLocalProfile();
  if (profile && profile.core_identity.trim()) {
    const formats = Object.keys(profile.contexts);
    return { exists: true, formats };
  }
  return { exists: false, formats: [] };
}

export async function listFormats(): Promise<string[]> {
  const overview = await getProfileOverview();
  return overview.formats;
}

// ============================================================
// Local profile — chrome.storage.local (BYOK users)
// ============================================================

export async function readLocalProfile(): Promise<ProfileContent | null> {
  const result = await chrome.storage.local.get("voice_profile");
  return result.voice_profile || null;
}

export async function saveLocalProfile(profile: ProfileContent): Promise<void> {
  await chrome.storage.local.set({ voice_profile: profile });
}

export async function readProfileContent(): Promise<ProfileContent> {
  const settings = await getSettings();

  if (settings.inference_mode === "noren_pro" && settings.noren_pro_logged_in) {
    try {
      return await apiJson<ProfileContent>("/profile/voice/export", { method: "POST" });
    } catch {
      return {
        core_identity: "Your voice profile is managed on the server. Upgrade to view and export your profile.",
        contexts: {},
      };
    }
  }

  const local = await readLocalProfile();
  return local || { core_identity: "", contexts: {} };
}

export async function saveProfileEdit(params: {
  coreIdentity: string;
  contextFormat?: string;
  contextContent?: string;
}): Promise<void> {
  const settings = await getSettings();

  if (settings.inference_mode === "noren_pro" && settings.noren_pro_logged_in) {
    await apiJson("/profile/voice/edit", {
      method: "POST",
      body: JSON.stringify({
        core_identity: params.coreIdentity,
        context_format: params.contextFormat,
        context_content: params.contextContent,
      }),
    });
    return;
  }

  // BYOK — save locally
  const existing = await readLocalProfile() || { core_identity: "", contexts: {} };
  existing.core_identity = params.coreIdentity;
  if (params.contextFormat && params.contextContent !== undefined) {
    existing.contexts[params.contextFormat] = params.contextContent;
  }
  await saveLocalProfile(existing);
}

/** Get the voice profile text for injection into system prompts */
export async function getVoiceProfileText(format?: string): Promise<string | null> {
  const settings = await getSettings();

  if (settings.inference_mode === "noren_pro" && settings.noren_pro_logged_in) {
    return null;
  }

  const profile = await readLocalProfile();
  if (!profile || !profile.core_identity.trim()) return null;

  let text = profile.core_identity;
  if (format && format !== "general" && profile.contexts[format]) {
    text += `\n\n[Context for ${format}]:\n${profile.contexts[format]}`;
  }
  return text;
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

export async function verifyEmail(code: string): Promise<string> {
  const data = await apiJson<{ message: string }>("/auth/verify-email", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  return data.message;
}

export async function resendOtp(): Promise<string> {
  const data = await apiJson<{ message: string }>("/auth/resend-otp", {
    method: "POST",
  });
  return data.message;
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
    body: JSON.stringify({ target: tier }),
  });
}

export async function openBillingPortal(): Promise<string> {
  const data = await apiJson<{ portal_url: string }>("/billing/portal", { method: "POST" });
  return data.portal_url;
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
  const testKey = key || await getApiKey(settings.provider.name);

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
  // 1. Check if text was stored by the context menu handler
  try {
    const stored = await chrome.storage.session.get("context_text");
    if (stored.context_text) {
      await chrome.storage.session.remove("context_text");
      return stored.context_text;
    }
  } catch { /* session storage may not be available */ }

  // 2. Fall back to querying the active tab's selection
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

// ============================================================
// Announcements — public, no auth
// ============================================================

export interface Announcement {
  id: string;
  type: string;
  title: string;
  body: string;
  cta_url: string | null;
  cta_label: string | null;
  published_at: string;
}

export async function fetchAnnouncements(since?: string): Promise<Announcement[]> {
  try {
    const url = `${API_BASE}/announcements${since ? `?since=${since}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

// ============================================================
// Edit logging — local storage + batch upload
// ============================================================

export async function logEdit(format: string, original: string, edited: string): Promise<void> {
  const result = await chrome.storage.local.get("edit_log");
  const log: EditLogEntry[] = result.edit_log || [];
  log.push({ format, original, edited, app: "noren-ext", timestamp: Date.now() });
  await chrome.storage.local.set({ edit_log: log });
}

export async function getEditLogCount(): Promise<number> {
  const result = await chrome.storage.local.get("edit_log");
  const log: EditLogEntry[] = result.edit_log || [];
  return log.length;
}

export async function uploadEditLog(): Promise<void> {
  const result = await chrome.storage.local.get("edit_log");
  const log: EditLogEntry[] = result.edit_log || [];
  if (log.length === 0) return;
  await apiJson("/profile/upload-edits", {
    method: "POST",
    body: JSON.stringify({ edits: log }),
  });
  await chrome.storage.local.remove("edit_log");
}

// ============================================================
// Living profile
// ============================================================

export async function refreshLivingProfile(): Promise<RefreshResponse> {
  return apiJson<RefreshResponse>("/profile/refresh", { method: "POST" });
}

export async function getRefreshHistory(limit?: number, offset?: number): Promise<RefreshHistoryEntry[]> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set("limit", String(limit));
  if (offset !== undefined) params.set("offset", String(offset));
  const qs = params.toString();
  return apiJson<RefreshHistoryEntry[]>(`/profile/refresh-history${qs ? `?${qs}` : ""}`);
}

export async function rollbackProfile(): Promise<void> {
  await apiJson("/profile/voice/rollback", { method: "POST" });
}

// ============================================================
// Full profile metadata
// ============================================================

export async function getProfileMetadata(): Promise<ProfileMetadata> {
  return apiJson<ProfileMetadata>("/profile/voice/metadata");
}

// ============================================================
// Sync
// ============================================================

export async function syncProfileUp(): Promise<void> {
  const res = await apiFetch("/sync/profile", { method: "PUT" });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
}

export async function syncProfileDown(): Promise<void> {
  const res = await apiFetch("/sync/profile");
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return apiJson<SyncStatus>("/sync/status");
}
