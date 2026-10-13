import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles/index.css'

document.documentElement.dataset.theme = 'light'

createApp(App).use(router).mount('#campus-root')

