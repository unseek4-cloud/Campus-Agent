<script setup>
import { RouterView } from 'vue-router'
import UserMenu from './UserMenu.vue'
const props = defineProps({ workspace: { type: Object, required: true }, state: { type: Object, required: true } })
function selectRoute(route) {
  props.workspace.actions.navigate(route)
  if (innerWidth <= 768) props.workspace.actions.closeDrawer()
}
</script>

<template>
<div id="app">
    
    <aside class="sidebar" id="sidebar">
      <span class="sm-prelayers" id="smPrelayers" aria-hidden="true">
        <i class="sm-prelayer" data-nudge="0"></i>
        <i class="sm-prelayer" data-nudge="10"></i>
        <i class="sm-prelayer" data-nudge="20"></i>
      </span>

      <div class="brand">
        <div class="brand-text">
          <div class="brand-name">CampusAgent</div>
          <div class="brand-sub">可信政策 · 办事引导</div>
        </div>
      </div>

      <nav class="nav" id="nav">
        <div class="nav-group">
          <div class="nav-label">工作台</div>
          <a class="nav-item" href="#/qa" data-route="qa" data-short="问答" title="智能问答" :class="{ active: state.route === 'qa' }" @click.prevent="selectRoute('qa')">
            <span>智能问答</span>
          </a>
          <a class="nav-item" href="#/dashboard" data-route="dashboard" data-short="概览" title="事务概览" :class="{ active: state.route === 'dashboard' }" @click.prevent="selectRoute('dashboard')">
            <span>事务概览</span>
          </a>
          <a class="nav-item" href="#/search" data-route="search" data-short="检索" title="政策检索" :class="{ active: state.route === 'search' }" @click.prevent="selectRoute('search')">
            <span>政策检索</span>
          </a>
          <a class="nav-item" href="#/affairs" data-route="affairs" data-short="引导" title="办事引导" :class="{ active: state.route === 'affairs' }" @click.prevent="selectRoute('affairs')">
            <span>办事引导</span>
          </a>
        </div>
        <div class="nav-group" data-nav-role="student" v-show="state.user?.role === 'student'">
          <div class="nav-label">我的事务</div>
          <a class="nav-item" href="#/my-applications" data-route="my-applications" data-short="申请" title="我的申请" :class="{ active: state.route === 'my-applications' }" @click.prevent="selectRoute('my-applications')">
            <span>我的申请</span>
          </a>
        </div>

        
        <div class="nav-group" data-nav-role="admin" v-show="state.user?.role === 'admin'">
          <div class="nav-label">管理与治理</div>
          <a class="nav-item" href="#/policy-mgr" data-route="policy-mgr" data-short="政策" title="政策管理" :class="{ active: state.route === 'policy-mgr' }" @click.prevent="selectRoute('policy-mgr')">
            <span>政策管理</span>
          </a>
          <a class="nav-item" href="#/services-mgr" data-route="services-mgr" data-short="事项" title="事项管理" :class="{ active: state.route === 'services-mgr' }" @click.prevent="selectRoute('services-mgr')">
            <span>事项管理</span>
          </a>
          <a class="nav-item" href="#/review" data-route="review" data-short="审核" title="申请审核" :class="{ active: state.route === 'review' }" @click.prevent="selectRoute('review')">
            <span>申请审核</span>
          </a>
          <a class="nav-item" href="#/audit" data-route="audit" data-short="审计" title="审计追溯" :class="{ active: state.route === 'audit' }" @click.prevent="selectRoute('audit')">
            <span>审计追溯</span>
          </a>
          <a class="nav-item" href="#/ai-quality" data-route="ai-quality" data-short="质量" title="AI 问答质量分析" :class="{ active: state.route === 'ai-quality' }" @click.prevent="selectRoute('ai-quality')"><span>AI 问答质量分析</span></a>
          <a class="nav-item" href="#/settings" data-route="settings" data-short="设置" title="系统设置" :class="{ active: state.route === 'settings' }" @click.prevent="selectRoute('settings')">
            <span>系统设置</span>
          </a>
        </div>

        <div class="nav-group chat-history-group" id="chatHistoryGroup">
          <div class="history-heading"><span class="nav-label">最近对话</span><button class="history-new" type="button" @click="workspace.actions.newConversation()" aria-label="新建对话" title="新建对话">＋</button></div>
          <div id="convList" class="conv-list" aria-label="历史会话"></div>
        </div>
      </nav>

      <div class="sidebar-foot">
        <UserMenu :workspace="workspace" :state="state" />
        
      </div>
    </aside>

    
    <div class="sm-scrim" id="smScrim" aria-hidden="true"></div>

    
    <main class="main">
      <header class="topbar">
        <div class="topbar-left">
          <button class="icon-btn" id="sidebarToggle" title="折叠侧边栏" aria-label="折叠侧边栏" aria-expanded="true" aria-controls="sidebar">
            <span class="sm-burger" id="smBurger" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg>
            </span>
          </button>
          <div class="crumb" id="crumb"></div>
        </div>
        <div class="topbar-right">
          <div class="search-pill">
            <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
            <input type="text" placeholder="搜索校园政策与事项" id="globalSearch" aria-label="搜索校园政策与事项" />
            <kbd>Ctrl K</kbd>
          </div>
        </div>
      </header>

      <section class="viewport" id="viewport">
        <RouterView v-if="state.auth === 'in'" v-slot="{ Component }">
          <component :is="Component" :key="$route.path" :workspace="workspace" />
        </RouterView>
      </section>
    </main>
  </div>
</template>
