<script lang="ts">
  import { getSettings, getProfileOverview, sendSupportMessage } from "$lib/api/noren";

  let hasProfile = $state(false);
  let isProLoggedIn = $state(false);
  let contactMessage = $state("");
  let contactState: "idle" | "sending" | "sent" | "error" = $state("idle");
  let openFaq = $state<number | null>(null);

  $effect(() => {
    getProfileOverview().then((o) => { hasProfile = o.exists; });
    getSettings().then((s) => { isProLoggedIn = s.noren_pro_logged_in; });
  });

  async function handleSend() {
    if (!contactMessage.trim() || contactState === "sending") return;
    contactState = "sending";
    try {
      await sendSupportMessage(contactMessage.trim());
      contactState = "sent";
      contactMessage = "";
      setTimeout(() => { contactState = "idle"; }, 3000);
    } catch {
      contactState = "error";
      setTimeout(() => { contactState = "idle"; }, 3000);
    }
  }

  function toggleFaq(index: number) {
    openFaq = openFaq === index ? null : index;
  }

  const faqItems = [
    { category: "Product", items: [
      { q: "What is Noren?", a: "Noren extracts your writing voice into a structured voice profile, then uses it to generate text that sounds like you. Think of it as a style guide the AI actually follows." },
      { q: "How do I get started?", a: "Download the desktop app or Chrome extension. During onboarding, paste writing samples, upload files, or do a guided interview if you don't have samples ready. After extraction, you'll have a working voice profile." },
      { q: "What is a voice profile?", a: "A structured Markdown file that captures your writing patterns: sentence rhythms, word preferences, rhetorical moves, anti-patterns, and more. It's human-readable and fully editable." },
      { q: "How is Noren different from Jasper or Copy.ai?", a: "Brand voice tools extract tone and vocabulary. Noren extracts structural patterns: named rhetorical moves, analogy domains, micro-constructions, and anti-patterns. The result is an inspectable Markdown profile, not an opaque model." },
      { q: "Can I extract someone else's voice?", a: "Yes. Paste their writing samples instead of yours. Useful for ghostwriters who need to write in a client's voice or content agencies managing multiple brand accounts." },
      { q: "Can I edit my profile?", a: "Yes. Profiles are plain Markdown. You can edit them directly in the app to remove false patterns, add missing preferences, or tune how strongly certain habits are enforced." },
      { q: "What platforms does Noren run on?", a: "macOS desktop app (menu bar, Cmd+K from any text field) and Chrome extension." },
    ]},
    { category: "Technical", items: [
      { q: "How does extraction work?", a: "You provide writing samples and Noren runs a multi-pass analysis: surface patterns, deep structure, cross-format comparison, and quality verification. The output is a human-readable Markdown profile you can inspect and edit." },
      { q: "How many samples do I need?", a: "5-10 per format gets you basic patterns. 10-25 per format gives solid coverage. Mix formats like tweets, blog posts, and emails for the best results." },
      { q: "What if I don't have writing samples?", a: "Noren includes a guided interview that walks you through short prompts designed to capture your natural voice. No existing writing required. Baseline profile in under 10 minutes." },
      { q: "How long does extraction take?", a: "About an hour. The engine runs a rigorous multi-stage analysis across all your samples, verifying every finding against your originals." },
      { q: "Which providers are supported?", a: "Anthropic (Claude, recommended), OpenAI (GPT-4 and later), Google (Gemini), and Ollama for fully offline local models. Free tier users bring their own API key." },
      { q: "Can I use Noren offline?", a: "Yes. Configure Ollama as your provider and all extraction and generation runs locally. No data leaves your machine." },
    ]},
  ];

  let faqFlat: { q: string; a: string; category: string }[] = [];
  for (const group of faqItems) {
    for (const item of group.items) {
      faqFlat.push({ ...item, category: group.category });
    }
  }
</script>

<div class="h-full overflow-y-auto">
  <div class="px-5 py-5">

    <!-- Header -->
    <div class="mb-6">
      <h1 class="font-heading italic font-light text-lg text-foreground tracking-tight mb-1">Help</h1>
      <p class="text-[11px] text-muted">Quick reference, common questions, and how to reach us.</p>
    </div>

    <!-- Getting Started -->
    <section class="mb-7">
      <div class="flex items-center gap-2 mb-3">
        <span class="font-heading italic text-[13px] text-accent">Getting started</span>
        <div class="flex-1 h-px bg-gradient-to-r from-border to-transparent"></div>
      </div>
      <div class="flex flex-col gap-1.5">
        {#if !hasProfile}
          <div class="flex items-start gap-2.5 p-3 bg-surface border border-border rounded-lg shadow-card">
            <span class="font-heading italic text-base text-accent opacity-35 leading-none min-w-[18px] pt-px">01</span>
            <p class="text-xs text-foreground leading-relaxed"><strong class="font-medium">Extract your voice.</strong> Paste 10+ writing samples across formats.</p>
          </div>
          <div class="flex items-start gap-2.5 p-3 bg-surface border border-border rounded-lg shadow-card">
            <span class="font-heading italic text-base text-accent opacity-35 leading-none min-w-[18px] pt-px">02</span>
            <p class="text-xs text-foreground leading-relaxed"><strong class="font-medium">No samples?</strong> Use the guided interview to capture your voice in 10 minutes.</p>
          </div>
        {:else}
          <div class="flex items-start gap-2.5 p-3 bg-surface border border-border rounded-lg shadow-card">
            <span class="font-heading italic text-base text-accent opacity-35 leading-none min-w-[18px] pt-px">01</span>
            <p class="text-xs text-foreground leading-relaxed"><strong class="font-medium">Highlight text anywhere.</strong> Use Rewrite, Reply, or Fix to edit in your voice inline.</p>
          </div>
          <div class="flex items-start gap-2.5 p-3 bg-surface border border-border rounded-lg shadow-card">
            <span class="font-heading italic text-base text-accent opacity-35 leading-none min-w-[18px] pt-px">02</span>
            <p class="text-xs text-foreground leading-relaxed"><strong class="font-medium">Generate in your voice.</strong> Open the side panel, pick a format, and write a prompt.</p>
          </div>
        {/if}
      </div>
    </section>

    <!-- FAQ -->
    <section class="mb-7">
      <div class="flex items-center gap-2 mb-3">
        <span class="font-heading italic text-[13px] text-accent">Common questions</span>
        <div class="flex-1 h-px bg-gradient-to-r from-border to-transparent"></div>
      </div>
      <div>
        {#each faqFlat as item, i}
          {#if i === 0 || faqFlat[i - 1].category !== item.category}
            <p class="text-[9px] font-medium uppercase tracking-widest text-muted {i > 0 ? 'mt-2' : ''} mb-0.5">{item.category}</p>
          {/if}
          <div class="border-b border-border last:border-b-0">
            <button
              onclick={() => toggleFaq(i)}
              class="w-full flex items-center gap-2 py-2.5 text-left text-xs font-medium text-foreground hover:text-accent transition-colors cursor-pointer"
            >
              <span class="w-[3px] h-3.5 rounded-sm shrink-0 transition-colors {openFaq === i ? 'bg-accent' : 'bg-transparent'}"></span>
              <span class="flex-1">{item.q}</span>
              <svg class="w-3.5 h-3.5 shrink-0 text-muted opacity-50 transition-transform duration-200 {openFaq === i ? 'rotate-180 text-accent opacity-70' : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            {#if openFaq === i}
              <div class="pb-2.5 pl-[11px]">
                <p class="text-[11px] text-muted leading-relaxed">{item.a}</p>
              </div>
            {/if}
          </div>
        {/each}
      </div>
      <a href="https://usenoren.ai/help" target="_blank" class="inline-block mt-2.5 text-[11px] font-medium text-secondary hover:text-accent transition-colors">
        Full help center at usenoren.ai/help &rarr;
      </a>
    </section>

    <!-- Contact -->
    <section class="mb-7">
      <div class="flex items-center gap-2 mb-3">
        <span class="font-heading italic text-[13px] text-accent">Contact us</span>
        <div class="flex-1 h-px bg-gradient-to-r from-border to-transparent"></div>
      </div>
      {#if isProLoggedIn}
        <div class="flex flex-col gap-2">
          <textarea
            bind:value={contactMessage}
            maxlength={2000}
            placeholder="What can we help with?"
            class="w-full min-h-[72px] px-3 py-2.5 text-xs text-foreground bg-surface border border-border rounded-lg shadow-inset outline-none resize-y leading-relaxed placeholder:text-muted/60 focus:border-accent focus:shadow-[inset_0_1px_2px_rgba(30,49,72,0.04),0_0_0_2px_rgba(122,51,64,0.06)] transition-[border-color,box-shadow]"
          ></textarea>
          <div class="flex items-center justify-between">
            <span class="text-[10px] text-muted opacity-60">{contactMessage.length.toLocaleString()} / 2,000</span>
            {#if contactState === "sent"}
              <span class="flex items-center gap-1.5 text-[11px] font-medium text-signal">
                <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>
                Sent. We'll get back to you.
              </span>
            {:else if contactState === "error"}
              <span class="text-[11px] text-error">Something went wrong. Try again.</span>
            {:else}
              <button
                onclick={handleSend}
                disabled={!contactMessage.trim() || contactState === "sending"}
                class="px-4 py-1.5 text-[11px] font-medium text-surface bg-accent rounded-md hover:bg-[#8B3D4A] active:scale-[0.97] transition-[background,transform] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {contactState === "sending" ? "Sending..." : "Send message"}
              </button>
            {/if}
          </div>
        </div>
      {:else}
        <p class="text-xs text-muted">Questions? Reach us at <a href="mailto:support@usenoren.ai" class="font-medium text-secondary hover:text-accent transition-colors">support@usenoren.ai</a></p>
      {/if}
    </section>

    <!-- About -->
    <div class="h-px bg-border opacity-50 mb-3"></div>
    <div class="flex items-center justify-between pb-2">
      <span class="text-[10px] text-muted opacity-50">Noren v0.1.0</span>
      <a href="https://usenoren.ai" target="_blank" class="text-[10px] text-muted opacity-50 hover:opacity-80 transition-opacity">usenoren.ai</a>
    </div>
  </div>
</div>
