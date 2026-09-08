import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import './styles/main.css';
import { applyServerConstants } from './utils/constants.js';
import { api } from './api/request.js';
import { installTableScrollHints } from './utils/tableScrollHint.js';

// D5 单一事实源：启动时拉取后端 /api/constants 覆盖标签类常量（失败静默，用本地兜底值）
api.constants().then(applyServerConstants).catch(() => {});

const app = createApp(App);
app.use(router);
app.mount('#app');

// 表格横向滚动右侧渐隐提示（手机端）
installTableScrollHints();
