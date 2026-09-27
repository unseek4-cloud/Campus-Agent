<script setup lang="ts">
import UserMenu from '../auth/UserMenu.vue'
import './applications.css'
</script>
<template><div class="student-applications"><header class="application-topbar"><router-link to="/" class="application-brand">CampusAgent</router-link><nav><router-link to="/knowledge/search">AI 问答</router-link></nav><UserMenu /></header><main class="application-content"><router-view /></main></div></template>
