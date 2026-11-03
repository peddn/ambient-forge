import "@fontsource/atkinson-hyperlegible/400.css";
import "@fontsource/atkinson-hyperlegible/700.css";
import "@fontsource/big-shoulders-stencil/700.css";
import "./styles/base.css";

import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import { createPultRouter } from "./router.js";

const app = createApp(App);
app.use(createPinia());
app.use(createPultRouter());
app.mount("#app");
