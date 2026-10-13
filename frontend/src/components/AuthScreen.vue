<script setup>
defineProps({ workspace: { type: Object, required: true } })
</script>

<template>
<div class="auth-screen" id="authScreen">
    <div class="auth-glow" aria-hidden="true"></div>

    <div class="auth-shell">
      
      <aside class="auth-aside">
        <div class="auth-brand">
          <div class="auth-brand-text">
            <div class="auth-brand-name">CampusAgent</div>
            <div class="auth-brand-sub">可信政策 · 办事引导</div>
          </div>
        </div>

        
        <h1 class="auth-aside-title" id="authTitle">
          <span class="auth-title-line">高校事务智能问答</span>
          <span class="auth-title-line">与办事引导系统</span>
        </h1>

        <ul class="auth-points">
          <li>
            
            <div><b>政策可信问答</b><span>回答附带政策原文引用，证据不足时明确提示</span></div>
          </li>
          <li>
            
            <div><b>办事流程引导</b><span>材料清单、办理步骤与进度一站式跟进</span></div>
          </li>
          <li>
            
            <div><b>角色分级权限</b><span>管理员与学生按后端角色划分可见范围</span></div>
          </li>
        </ul>

        <div class="auth-aside-foot">校园政策有据可查，办理步骤清晰可循。</div>
      </aside>

      
      <section class="auth-main">
        <form class="auth-card" id="loginForm" novalidate>
          <header class="auth-card-head">
            <h2>登录</h2>
            <p>请使用学校统一身份账号登录</p>
          </header>

          <div class="auth-field">
            <label for="loginUser">账号</label>
            <div class="auth-input">
              
              <input id="loginUser" name="username" type="text" maxlength="80" required
                     autocomplete="username" placeholder="admin 或学号" spellcheck="false" />
            </div>
          </div>

          <div class="auth-field">
            <label for="loginPass">密码</label>
            <div class="auth-input">
              
              <input id="loginPass" name="password" type="password" required
                     autocomplete="current-password" placeholder="请输入密码" />
              <button type="button" class="ai-toggle" data-toggle-for="loginPass" aria-label="显示密码">显示</button>
            </div>
          </div>

          <div class="auth-alert" id="loginErr" role="alert" aria-live="polite" hidden></div>

          <button class="auth-submit" id="loginBtn" type="submit">
            <span class="as-label">登 录</span>
            <span class="as-spin" aria-hidden="true"></span>
          </button>

          <div class="auth-caps" id="loginCaps" hidden>大写锁定已开启</div>
        </form>

        
        <form class="auth-card" id="changePwdForm" novalidate>
          <header class="auth-card-head">
            <h2>修改初始密码</h2>
            <p>首次登录必须先设置新密码</p>
          </header>

          <div class="auth-note">
            你好，<b id="pwdWho">同学</b>。为保障账号安全，请先修改初始密码。修改成功后当前会话立即失效，需要用新密码重新登录。
          </div>

          <div class="auth-field">
            <label for="pwdOld">原密码</label>
            <div class="auth-input">
              
              <input id="pwdOld" type="password" required autocomplete="current-password" placeholder="请输入原密码" />
              <button type="button" class="ai-toggle" data-toggle-for="pwdOld" aria-label="显示密码">显示</button>
            </div>
          </div>

          <div class="auth-field">
            <label for="pwdNew">新密码</label>
            <div class="auth-input">
              
              <input id="pwdNew" type="password" required autocomplete="new-password" placeholder="8~20 位，需同时含字母和数字" />
              <button type="button" class="ai-toggle" data-toggle-for="pwdNew" aria-label="显示密码">显示</button>
            </div>
          </div>

          <div class="auth-field">
            <label for="pwdConfirm">确认新密码</label>
            <div class="auth-input">
              
              <input id="pwdConfirm" type="password" required autocomplete="new-password" placeholder="请再次输入新密码" />
              <button type="button" class="ai-toggle" data-toggle-for="pwdConfirm" aria-label="显示密码">显示</button>
            </div>
          </div>

          <div class="auth-alert" id="pwdErr" role="alert" aria-live="polite" hidden></div>

          <button class="auth-submit" id="pwdSubmitBtn" type="submit">
            <span class="as-label">确认修改</span>
            <span class="as-spin" aria-hidden="true"></span>
          </button>

          <div class="auth-caps" id="pwdCaps" hidden>大写锁定已开启</div>

          <div class="auth-foot-link"><a id="pwdLogoutBtn" role="button" tabindex="0">退出登录</a></div>
        </form>
      </section>
    </div>
  </div>
</template>
