import { mount, unmount, type Component } from "svelte";

export interface ShadowMountResult {
  host: HTMLElement;
  update: (props: Record<string, unknown>) => void;
  destroy: () => void;
}

/**
 * Mount a Svelte component inside a Shadow DOM container.
 * CSS is injected via adoptedStyleSheets for full isolation from the host page.
 */
export function createShadowMount(
  component: Component,
  props: Record<string, unknown>,
  css: string,
  hostTag = "noren-ui",
): ShadowMountResult {
  const host = document.createElement(hostTag);
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.pointerEvents = "none";

  const shadow = host.attachShadow({ mode: "open" });

  // Inject CSS via adoptedStyleSheets (Chrome 73+)
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  shadow.adoptedStyleSheets = [sheet];

  const container = document.createElement("div");
  container.style.pointerEvents = "auto";
  shadow.appendChild(container);

  let instance = mount(component, { target: container, props });

  return {
    host,
    update: (nextProps: Record<string, unknown>) => {
      unmount(instance);
      instance = mount(component, { target: container, props: nextProps });
    },
    destroy: () => {
      unmount(instance);
      host.remove();
    },
  };
}
