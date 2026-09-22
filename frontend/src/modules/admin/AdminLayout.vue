<script setup lang="ts">
import { ref } from 'vue'
import { DataBoard, Files, Fold, Expand, School } from './icons'
import './admin.css'
const collapsed = ref(false)
</script>

<template>
  <div class="admin-shell" :class="{ compact: collapsed }">
    <aside class="admin-sidebar">
      <router-link class="admin-brand" to="/admin"><span class="brand-mark"><el-icon><School /></el-icon></span><span v-if="!collapsed">CampusAgent<small>知识管理后台</small></span></router-link>
      <div class="nav-caption" v-if="!collapsed">工作空间</div>
      <nav class="admin-nav" aria-label="管理员导航">
        <router-link to="/admin" exact-active-class="active"><el-icon><DataBoard /></el-icon><span v-if="!collapsed">总览</span></router-link>
        <router-link to="/admin/knowledge" active-class="active"><el-icon><Files /></el-icon><span v-if="!collapsed">知识库管理</span></router-link>
        <router-link to="/admin/services" active-class="active"><el-icon><School /></el-icon><span v-if="!collapsed">办事事项管理</span></router-link>
      </nav>
      <div class="sidebar-foot"><span v-if="!collapsed">校园知识，清晰可管</span><button class="collapse-button" aria-label="切换侧边栏" @click="collapsed = !collapsed"><el-icon><Expand v-if="collapsed" /><Fold v-else /></el-icon></button></div>
    </aside>
    <div class="admin-main">
      <header class="admin-topbar"><div class="breadcrumb">管理后台 <span>/</span> {{ $route.name === 'admin-overview' ? '总览' : $route.name === 'admin-services' ? '办事事项管理' : '知识库管理' }}</div><div class="admin-avatar">管理</div></header>
      <main class="admin-content"><router-view /></main>
    </div>
  </div>
</template>
