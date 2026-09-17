import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'

import App from './App.vue'
import router from './app/router'
import './shared/styles/main.css'

createApp(App).use(ElementPlus).use(router).mount('#app')

