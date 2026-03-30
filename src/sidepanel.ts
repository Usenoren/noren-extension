import App from "./App.svelte";
import { mount } from "svelte";
import { initTheme } from "$lib/stores/theme.svelte";
import "./sidepanel.css";

initTheme();
mount(App, { target: document.getElementById("app")! });
