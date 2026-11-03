import { createRouter, createWebHistory } from "vue-router";

import ShellLayout from "./components/ShellLayout.vue";
import { usePult } from "./stores/pult.js";
import DeskView from "./views/DeskView.vue";
import DisplayView from "./views/DisplayView.vue";
import EffectsView from "./views/EffectsView.vue";
import FilesView from "./views/FilesView.vue";
import LoginView from "./views/LoginView.vue";

export function createPultRouter() {
  const router = createRouter({
    history: createWebHistory("/admin/"),
    routes: [
      { path: "/login", name: "login", component: LoginView, meta: { public: true } },
      {
        path: "/",
        component: ShellLayout,
        children: [
          { path: "", name: "desk", component: DeskView },
          { path: "projekt/:projectId", name: "project", component: DeskView, props: true },
          { path: "effekte", name: "effects", component: EffectsView },
          { path: "dateien", name: "files", component: FilesView },
          { path: "anzeige", name: "display", component: DisplayView },
        ],
      },
      { path: "/:rest(.*)*", redirect: "/" },
    ],
  });

  router.beforeEach(async (to) => {
    const pult = usePult();
    pult.onSignedOut(() => router.push({ name: "login" }));
    if (to.meta.public) return true;
    if (pult.signedIn) return true;
    const started = await pult.start();
    return started ? true : { name: "login" };
  });

  return router;
}
