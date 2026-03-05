import App from "./App.svelte";
import { mount } from "svelte";
import "./sidepanel.css";

mount(App, { target: document.getElementById("app")! });
