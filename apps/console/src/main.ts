import { createApp } from "vue";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";

import { router } from "./router";
import App from "./App.vue";
import "element-plus/dist/index.css";
import "./styles/index.css";

createApp(App).use(router).use(ElementPlus, { locale: zhCn }).mount("#app");
