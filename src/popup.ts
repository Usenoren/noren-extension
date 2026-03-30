import App from "./App.svelte";
import { mount } from "svelte";
import { initTheme } from "$lib/stores/theme.svelte";
import "./app.css";

initTheme();
mount(App, { target: document.getElementById("app")! });
