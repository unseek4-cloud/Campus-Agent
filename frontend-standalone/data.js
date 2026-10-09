/* ============================================================
   CampusAgent · Mock 数据
   覆盖：政策库、事项库、问答示例、审计记录、统计数据
   ============================================================ */

window.MOCK = {
  /* ---------- 用户账号与权限 ---------- */
  users: [
    { username: "admin", password: "admin123", name: "系统管理员", role: "admin", avatar: "管", dept: "信息化建设与管理处" },
    { username: "student", password: "student123", name: "林知远", role: "student", avatar: "学", dept: "计算机学院" },
    { username: "knowledge", password: "know123", name: "陈编辑", role: "knowledge", avatar: "知", dept: "政策研究室" },
    { username: "auditor", password: "audit123", name: "王审计", role: "auditor", avatar: "审", dept: "监察处" }
  ],

  /* ---------- 角色权限矩阵 ---------- */
  permissions: {
    // 系统管理员：全部权限
    admin: {
      policyUpload: true,
      policyDelete: true,
      policyRebuild: true,
      affairEdit: true,
      auditExport: true,
      settingsEdit: true,
      userManage: true,
      qaUse: true,
      searchUse: true,
      affairView: true,
      auditView: true,
      settingsView: true
    },
    // 学生：仅查看与问答，不可增删
    student: {
      policyUpload: false,
      policyDelete: false,
      policyRebuild: false,
      affairEdit: false,
      auditExport: false,
      settingsEdit: false,
      userManage: false,
      qaUse: true,
      searchUse: true,
      affairView: true,
      auditView: true,
      settingsView: true
    },
    // 知识管理员：可管理政策，但不可改系统设置
    knowledge: {
      policyUpload: true,
      policyDelete: true,
      policyRebuild: true,
      affairEdit: false,
      auditExport: false,
      settingsEdit: false,
      userManage: false,
      qaUse: true,
      searchUse: true,
      affairView: true,
      auditView: true,
      settingsView: true
    },
    // 审计人员：可查看审计并导出，不可编辑
    auditor: {
      policyUpload: false,
      policyDelete: false,
      policyRebuild: false,
      affairEdit: false,
      auditExport: true,
      settingsEdit: false,
      userManage: false,
      qaUse: true,
      searchUse: true,
      affairView: true,
      auditView: true,
      settingsView: true
    }
  },

  /* ---------- 统计概览 ---------- */
  stats: {
    policies: 128,
    affairs: 46,
    qaToday: 342,
    traceRate: "100%",
    recall: "87.5%",
    citeAccuracy: "92.3%",
    users: 8640
  },

  /* ---------- 政策库 ---------- */
  policies: [
    {
      id: "P2026-001",
      title: "本科生国家奖学金评审管理办法",
      dept: "学生工作处",
      version: "v2026.3",
      status: "active",
      date: "2026-09-01",
      pages: 18,
      tags: ["奖学金", "评审", "本科生"],
      summary: "明确国家奖学金申请条件、评审程序、名额分配及公示要求，适用于全日制本科在校生。"
    },
    {
      id: "P2026-008",
      title: "学生证管理与补办实施细则",
      dept: "教务处",
      version: "v2026.1",
      status: "active",
      date: "2026-03-15",
      pages: 6,
      tags: ["学生证", "补办", "学籍"],
      summary: "规定学生证遗失后的挂失、补办流程、所需材料及办理时限。"
    },
    {
      id: "P2026-015",
      title: "学生公寓住宿管理规定",
      dept: "后勤管理处",
      version: "v2025.2",
      status: "active",
      date: "2025-11-20",
      pages: 22,
      tags: ["住宿", "公寓", "后勤"],
      summary: "涵盖入住登记、退宿流程、宿舍调整、违规处理及安全用电等条款。"
    },
    {
      id: "P2026-023",
      title: "本科生转专业管理办法",
      dept: "教务处",
      version: "v2026.2",
      status: "active",
      date: "2026-05-10",
      pages: 12,
      tags: ["转专业", "学籍", "教务"],
      summary: "规定转专业申请条件、考核方式、接收名额及学籍异动办理流程。"
    },
    {
      id: "P2025-031",
      title: "家庭经济困难学生认定办法",
      dept: "学生工作处",
      version: "v2025.1",
      status: "expired",
      date: "2025-04-01",
      pages: 10,
      tags: ["困难认定", "资助"],
      summary: "已被 P2026-042 替代。"
    },
    {
      id: "P2026-042",
      title: "家庭经济困难学生认定办法（修订）",
      dept: "学生工作处",
      version: "v2026.1",
      status: "active",
      date: "2026-09-01",
      pages: 11,
      tags: ["困难认定", "资助", "修订"],
      summary: "2026 年修订版，调整认定档次与评议程序。"
    },
    {
      id: "P2026-051",
      title: "校园网络与信息安全管理规定",
      dept: "信息化建设与管理处",
      version: "v2026.1",
      status: "active",
      date: "2026-06-01",
      pages: 15,
      tags: ["网络", "信息安全", "信息化"],
      summary: "校园网接入、账号管理、违规行为处置及个人信息保护要求。"
    },
    {
      id: "P2026-067",
      title: "本科生学业预警与学籍处理办法",
      dept: "教务处",
      version: "v2026.1",
      status: "draft",
      date: "2026-09-10",
      pages: 9,
      tags: ["学业预警", "学籍", "教务"],
      summary: "草稿，待 2026 年秋季学期校务会审议发布。"
    }
  ],

  /* ---------- 办事事项 ---------- */
  affairs: [
    {
      id: "A001",
      name: "国家奖学金申请",
      ico: "◈",
      color: "linear-gradient(135deg,#e8c98a,#f0b35e)",
      dept: "学生工作处",
      desc: "面向品学兼优本科生的国家级奖学金评审申请",
      steps: [
        { title: "在线提交申请", desc: "登录学生门户，填写奖学金申请表并上传佐证材料" },
        { title: "班级与学院初审", desc: "辅导员组织班级评议，学院学工办审核资格" },
        { title: "学校评审委员会复审", desc: "校奖评审委员会综合评定并确定拟获奖名单" },
        { title: "公示与异议处理", desc: "全校公示 5 个工作日，受理异议并复核" },
        { title: "奖金发放", desc: "公示无异议后，10 个工作日内发放至校园卡账户" }
      ],
      materials: [
        { name: "奖学金申请表（在线填写）", note: "系统自动生成" },
        { name: "学年成绩单", note: "教务系统导出 PDF" },
        { name: "获奖证书扫描件", note: "PDF/JPG，单个不超过 5MB" },
        { name: "社会实践证明", note: "加盖公章，可选" },
        { name: "家庭经济情况说明", note: "仅申请励志奖学金需提供" }
      ],
      timeline: "每年 9 月 15 日—10 月 10 日"
    },
    {
      id: "A002",
      name: "学生证补办",
      ico: "▤",
      color: "linear-gradient(135deg,#6fc3ff,#6d8bff)",
      dept: "教务处",
      desc: "学生证遗失或损毁后的正式补办流程",
      steps: [
        { title: "线上挂失", desc: "在教务系统提交学生证挂失申请，原证即时作废" },
        { title: "缴纳工本费", desc: "通过校园统一支付平台缴纳 20 元工本费" },
        { title: "提交照片", desc: "上传符合规范的近期免冠一寸彩色电子照片" },
        { title: "学院审核", desc: "学院教学秘书核验学籍信息" },
        { title: "领取新证", desc: "3 个工作日后到教务大厅自助机领取" }
      ],
      materials: [
        { name: "挂失申请单", note: "系统自动生成" },
        { name: "缴费凭证", note: "支付平台截图" },
        { name: "电子照片", note: "白底，295×413 像素" }
      ],
      timeline: "工作日 9:00–16:30，3 个工作日办结"
    },
    {
      id: "A003",
      name: "宿舍调换申请",
      ico: "⌂",
      color: "linear-gradient(135deg,#5fd4a8,#6fc3ff)",
      dept: "后勤管理处",
      desc: "因特殊原因申请调整宿舍床位",
      steps: [
        { title: "提交调换申请", desc: "在后勤服务平台填写调换原因及意向宿舍" },
        { title: "辅导员审批", desc: "辅导员核实情况并签署意见" },
        { title: "宿管中心审核", desc: "宿管中心根据空余床位统筹安排" },
        { title: "办理退宿与入住", desc: "原宿舍退宿验房，新宿舍领取钥匙" }
      ],
      materials: [
        { name: "宿舍调换申请表", note: "在线填写" },
        { name: "调换原因证明", note: "如医疗证明等，可选" }
      ],
      timeline: "每学期开学前两周集中受理"
    },
    {
      id: "A004",
      name: "本科生转专业",
      ico: "◐",
      color: "linear-gradient(135deg,#9b7cff,#6d8bff)",
      dept: "教务处",
      desc: "本科生在规定条件下申请转入其他专业",
      steps: [
        { title: "查阅接收方案", desc: "查看各专业接收名额、考核科目及报名条件" },
        { title: "在线报名", desc: "在转专业系统填报志愿（可填 3 个）" },
        { title: "参加考核", desc: "按要求参加笔试或面试" },
        { title: "拟录取公示", desc: "接收学院公示拟录取名单" },
        { title: "学籍异动办理", desc: "教务处办理学籍异动，学生确认培养方案" }
      ],
      materials: [
        { name: "转专业申请表", note: "系统生成" },
        { name: "在读成绩单", note: "教务系统导出" },
        { name: "特殊才能证明", note: "如竞赛获奖等，可选" }
      ],
      timeline: "每年 5 月中下旬，具体见当年通知"
    },
    {
      id: "A005",
      name: "困难学生认定",
      ico: "◍",
      color: "linear-gradient(135deg,#f0b35e,#f07680)",
      dept: "学生工作处",
      desc: "家庭经济困难学生资格认定，作为资助依据",
      steps: [
        { title: "学生个人申请", desc: "在线填写家庭经济情况调查表" },
        { title: "班级民主评议", desc: "班级评议小组评定困难档次" },
        { title: "学院审核公示", desc: "学院审核并公示 3 个工作日" },
        { title: "学校复核备案", desc: "学工部复核并录入资助系统" }
      ],
      materials: [
        { name: "家庭经济情况调查表", note: "在线填写" },
        { name: "家庭经济困难证明", note: "户籍地民政部门出具，可选" }
      ],
      timeline: "每年 9 月新生入学后启动"
    },
    {
      id: "A006",
      name: "校园网账号开通",
      ico: "⌖",
      color: "linear-gradient(135deg,#6d8bff,#5fd4a8)",
      dept: "信息化建设与管理处",
      desc: "新生校园网络账号开通与密码管理",
      steps: [
        { title: "统一身份认证激活", desc: "使用学号激活统一身份认证账号" },
        { title: "绑定手机与邮箱", desc: "完善个人联系方式用于找回密码" },
        { title: "自助开通网络", desc: "在网络自助服务平台选择套餐并缴费" }
      ],
      materials: [
        { name: "学号与初始密码", note: "随录取通知书发放" }
      ],
      timeline: "报到当天即可办理"
    }
  ],

  /* ---------- 问答对话示例 ---------- */
  qaSuggests: [
    "国家奖学金的申请条件是什么？",
    "学生证丢了怎么补办？要多久？",
    "转专业需要满足哪些成绩要求？",
    "家庭经济困难认定需要哪些材料？",
    "宿舍调换的流程是什么？",
    "校园网账号如何开通？"
  ],

  /* ---------- 政策引用片段库 ---------- */
  citations: {
    "国家奖学金": [
      { policy: "P2026-001", title: "本科生国家奖学金评审管理办法", version: "v2026.3", page: 3,
        text: "第二条 国家奖学金申请基本条件：（一）热爱社会主义祖国，拥护中国共产党的领导；（二）遵守宪法和法律，遵守学校规章制度；（三）诚实守信，道德品质优良；（四）在校期间学习成绩优异，上一学年智育成绩排名位于专业前 10%。" },
      { policy: "P2026-001", title: "本科生国家奖学金评审管理办法", version: "v2026.3", page: 5,
        text: "第五条 评审程序：学生本人申请 → 班级评议 → 学院初审 → 学校评审委员会复审 → 全校公示 5 个工作日。公示无异议后报上级主管部门备案。" }
    ],
    "学生证": [
      { policy: "P2026-008", title: "学生证管理与补办实施细则", version: "v2026.1", page: 2,
        text: "第六条 学生证遗失补办流程：（1）学生登录教务系统提交挂失申请；（2）通过统一支付平台缴纳工本费 20 元；（3）上传近期免冠一寸白底电子照片（295×413 像素）；（4）学院教学秘书核验；（5）3 个工作日后至教务大厅自助取证机领取。" }
    ],
    "转专业": [
      { policy: "P2026-023", title: "本科生转专业管理办法", version: "v2026.2", page: 4,
        text: "第七条 申请转专业的学生应同时满足：（一）入学满一学期；（二）已修课程无不及格记录；（三）智育成绩排名位于专业前 30%；（四）在校期间无违纪处分记录。" }
    ],
    "困难认定": [
      { policy: "P2026-042", title: "家庭经济困难学生认定办法（修订）", version: "v2026.1", page: 3,
        text: "第四条 认定档次分为特别困难、困难和一般困难三档。认定依据包括家庭收入、家庭成员情况、突发变故、地区经济水平等因素。学生须如实填写《家庭经济情况调查表》。" }
    ],
    "宿舍": [
      { policy: "P2026-015", title: "学生公寓住宿管理规定", version: "v2025.2", page: 8,
        text: "第十二条 学生因特殊情况确需调换宿舍的，应向所在学院辅导员提交书面申请，经辅导员同意后报宿管中心统筹安排。未经批准不得私自调换床位。" }
    ],
    "校园网": [
      { policy: "P2026-051", title: "校园网络与信息安全管理规定", version: "v2026.1", page: 2,
        text: "第三条 校园网账号实行统一身份认证。新生凭学号激活账号后，需在网络自助服务平台绑定手机号并选择资费套餐，缴费成功后即可使用校园有线和无线网络。" }
    ]
  },

  /* ---------- 审计记录 ---------- */
  audits: [
    {
      id: "REQ-20260924-001",
      type: "qa",
      level: "success",
      title: "问答：国家奖学金申请条件",
      time: "2026-09-24 14:32:08",
      user: "学 2023****",
      evidence: "已引用 P2026-001 第 3、5 页，检索候选 5 条，重排后采用 2 条，引用一致率校验通过。"
    },
    {
      id: "REQ-20260924-002",
      type: "policy",
      level: "info",
      title: "政策更新：P2026-042 发布",
      time: "2026-09-24 10:15:00",
      user: "知识管理员",
      evidence: "《家庭经济困难学生认定办法（修订）》v2026.1 发布，替代 P2025-031，索引已按文档幂等替换。"
    },
    {
      id: "REQ-20260924-003",
      type: "qa",
      level: "warn",
      title: "问答：关于下学期选课时间",
      time: "2026-09-24 09:47:22",
      user: "学 2024****",
      evidence: "知识库中未检索到 2026-2027 学年第二学期选课的正式通知，系统已返回「无法确认」并建议联系教务处。"
    },
    {
      id: "REQ-20260924-004",
      type: "qa",
      level: "danger",
      title: "问答：某专业是否包分配",
      time: "2026-09-24 09:12:55",
      user: "学 2025****",
      evidence: "问题超出政策知识库范围且涉及不存在的规则，系统触发无依据拒答策略，未生成确定回答。"
    },
    {
      id: "REQ-20260923-018",
      type: "policy",
      level: "success",
      title: "文档处理：P2026-067 草稿入库",
      time: "2026-09-23 16:40:33",
      user: "知识管理员",
      evidence: "PDF 共 9 页，文字型页面 9 页，切块 47 块，Embedding 模型 bge-large-zh-v1.5，索引写入 Chroma 成功。"
    },
    {
      id: "REQ-20260923-012",
      type: "audit",
      level: "info",
      title: "权限变更：授予业务管理员事项编辑权限",
      time: "2026-09-23 11:20:00",
      user: "系统管理员",
      evidence: "角色「业务管理员」新增 affair:write 权限，操作已记录并通知审计人员。"
    }
  ],

  /* ---------- 最近问答 ---------- */
  recentQA: [
    { q: "国家奖学金的申请条件是什么？", time: "2 分钟前", tag: "奖学金" },
    { q: "学生证补办需要什么材料？", time: "15 分钟前", tag: "学籍" },
    { q: "转专业的成绩要求", time: "1 小时前", tag: "教务" },
    { q: "宿舍调换流程", time: "2 小时前", tag: "后勤" }
  ]
};
