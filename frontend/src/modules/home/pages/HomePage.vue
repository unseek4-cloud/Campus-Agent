<template>
  <main class="home-page">
    <el-card class="intro-card" shadow="never">
      <template #header>
        <div class="card-header">
          <span>CampusAgent</span>
          <el-tag type="success">基础骨架已就绪</el-tag>
        </div>
      </template>

      <h1>高校事务智能问答与办事引导系统</h1>
      <p>可问、可查、可办、可追溯。</p>

      <el-divider />

      <el-space wrap>
        <el-tag>Vue 3</el-tag>
        <el-tag>Vite</el-tag>
        <el-tag>Element Plus</el-tag>
        <el-tag>Axios</el-tag>
      </el-space>

      <el-divider />

      <router-link to="/knowledge/search">
        <el-button type="primary">开始提问</el-button>
      </router-link>
    </el-card>
  </main>
</template>
