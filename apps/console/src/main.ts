import { createApp } from "vue";

import { router } from "./router";
import "./styles/index.css";
import ConsoleProviders from "./ui/naive/ConsoleProviders.vue";

createApp(ConsoleProviders).use(router).mount("#app");
