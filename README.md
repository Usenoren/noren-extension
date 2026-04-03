# Noren - Chrome Extension

AI writing assistant that learns your voice. Generate text, rewrite selections, and chat - all from your browser.

## Quick Start

```bash
npm install
npm run build
```

Load in Chrome:

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `dist/` folder

For development with hot reload:

```bash
npm run dev
```

Then reload the extension in Chrome after each change.

## How It Works

Noren runs in two modes:

- **Noren Pro** - sign in and go. We handle inference, voice profiles, and billing server-side.
- **BYOK (Bring Your Own Key)** - use your own API key with Anthropic, OpenAI, Google Gemini, or local Ollama.

### Extension Entry Points

| Entry Point | What It Does |
|---|---|
| **Side panel** | Main UI - tabbed interface with Generate, Chat, Profile, and Settings views |
| **Selection toolbar** | Floating quick actions (Rewrite, Shorten, Expand, Fix, Tone) when you select text on any page |
| **Context menu** | Right-click selected text → "Weave with Noren" opens the side panel with context |
| **Toolbar icon** | Click the extension icon to open the popup |

### Key User Flows

1. **Generate (Weave)** - type a prompt, pick a format and enforcement level, hit Weave. Output copies to clipboard automatically.
2. **Quick actions** - select text on any page, pick an action from the toolbar, result replaces the selection (or copies if the field is read-only).
3. **Chat** - multi-turn conversation with your voice profile injected. Supports markdown, message editing, and history.
4. **Context menu** - right-click selected text to open it as context in either Generate or Chat.

## Architecture

```
src/
├── background.ts          # Service worker: context menu, message relay, quick actions
├── content.ts             # Content script: selection toolbar, text injection
├── sidepanel.ts           # Side panel entry point
├── popup.ts               # Popup entry point
├── App.svelte             # Main UI shell (tab routing, onboarding, context passing)
└── lib/
    ├── api/
    │   ├── noren.ts       # All backend/LLM API calls
    │   └── keychain.ts    # OS keychain bridge (secure key storage via native messaging)
    ├── stores/
    │   └── subscription.svelte.ts
    ├── components/
    │   ├── GenerateView.svelte
    │   ├── ChatView.svelte
    │   ├── ProfileView.svelte
    │   ├── SettingsView.svelte
    │   └── OnboardingView.svelte
    ├── content/
    │   ├── SelectionToolbar.svelte
    │   └── shadow-mount.ts    # Shadow DOM isolation for injected UI
    └── utils/
        └── errors.ts
```

### Tech Stack

- **Svelte 5** with runes (`$state`, `$effect`)
- **Tailwind CSS v4**
- **Vite** + **CRXJS** for Chrome extension bundling
- **Chrome Manifest V3**
- **TypeScript** (strict mode)

### Security

- Shadow DOM isolates injected UI from page styles/scripts
- `DOMPurify` sanitizes all rendered markdown
- API keys stored in OS keychain via native messaging (falls back to `chrome.storage.local`)
- CORS handled through background worker proxy

## Permissions

| Permission | Why |
|---|---|
| `activeTab` + `scripting` | Inject selection toolbar and generated text |
| `storage` | Settings, auth tokens, chat history |
| `contextMenus` | "Weave with Noren" right-click option |
| `sidePanel` | Main UI surface |
| `nativeMessaging` | Secure key storage via Noren desktop app keychain |
| `declarativeNetRequest` | Strip origin headers for direct API calls (BYOK) |

## Keychain Bridge (Optional)

If the [Noren desktop app](https://github.com/mitrionxyz/noren-app) is installed, API keys are stored in the OS keychain instead of browser storage. The desktop app registers a native messaging host that the extension communicates with automatically. This is optional - the extension works fine without it.

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Watch mode build |
| `npm run build` | Production build → `dist/` |
| `npm run check` | Svelte + TypeScript type checking |

## License

[MIT](LICENSE)
