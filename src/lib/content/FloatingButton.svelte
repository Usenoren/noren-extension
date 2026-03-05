<script lang="ts">
  let { x, y, onAction }: { x: number; y: number; onAction: (action: string) => void } = $props();
</script>

<button
  class="noren-fab"
  style="left: {x}px; top: {y}px;"
  onclick={() => onAction("open-sidepanel")}
  title="Open Noren"
>
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#E8E3DD" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
    <path d="M19.5 7.125L16.862 4.487" />
  </svg>
</button>
