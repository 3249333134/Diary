// 生成测试日记数据，调用本地 API 保存
const API = "http://127.0.0.1:4319";

const diaries = [
  {
    date: "2026-10-05", weather: "多云", sleep: "7h", mood: "平静",
    facts: {
      events: [
        { id: "evt-1005-1", time: "08:30", note: "和李明在公司讨论了 Q4 产品规划", remark: "确定了三个核心方向：AI 辅助、社交化、轻量化", location: { name: "公司 3 楼会议室" },
          people: [{ type: "person", name: "李明", tags: ["同事", "产品"] }],
          places: [{ type: "place", name: "公司", tags: ["工作"] }],
          activities: [{ type: "activity", name: "开会", tags: [] }], foods: [], attachments: [] },
        { id: "evt-1005-2", time: "12:15", note: "和王芳在公司楼下吃了兰州拉面", remark: "王芳说最近在学日语，准备明年去日本旅行", location: { name: "公司楼下兰州拉面馆" },
          people: [{ type: "person", name: "王芳", tags: ["同事", "朋友"] }],
          places: [{ type: "place", name: "公司", tags: ["工作"] }],
          activities: [{ type: "activity", name: "吃午饭", tags: [] }],
          foods: [{ type: "food", name: "兰州拉面", tags: [] }], attachments: [] },
        { id: "evt-1005-3", time: "19:00", note: "在家打了八段锦", remark: "第三式调理脾胃须单举，感觉肩颈放松了不少", location: { name: "家客厅" },
          people: [], places: [{ type: "place", name: "家", tags: ["生活"] }],
          activities: [{ type: "activity", name: "打八段锦", tags: ["健身", "气功"] }], foods: [], attachments: [] },
      ], note: "今天工作节奏适中，晚上练了八段锦感觉不错。"
    },
    learn: { sources: [{ type: "thing", name: "得到课程", tags: [] }], content: "听了《组织行为学》第 12 讲：群体决策的优缺点。群体决策能汇集更多信息，但容易出现群体极化和从众压力。" },
    input: { kind: "书", names: [{ type: "thing", name: "《深度工作》", tags: [] }], excerpt: "深度工作是在无干扰的状态下专注进行职业活动，使个人的认知能力达到极限。这种努力能够创造新价值，提升技能，而且难以复制。" },
    idea: { tags: ["产品", "AI"], content: "如果把日记的实体关系做成时间线动画，会不会更有沉浸感？比如每一天的节点像星座一样连起来。" },
    todos: [
      { id: "todo-1005-1", title: "完成 Q4 规划初稿", done: true, time: "10:00", priority: "high", status: "done" },
      { id: "todo-1005-2", title: "回复客户邮件", done: true, time: "15:00", priority: "medium", status: "done" },
      { id: "todo-1005-3", title: "买牛奶", done: false, time: "", priority: "low", status: "todo" },
    ], todosExtra: ""
  },
  {
    date: "2026-10-06", weather: "晴", sleep: "6.5h", mood: "不错",
    facts: {
      events: [
        { id: "evt-1006-1", time: "07:30", note: "和张伟在朝阳公园跑步", remark: "五公里用时 28 分钟，比上周快了 1 分钟", location: { name: "朝阳公园" },
          people: [{ type: "person", name: "张伟", tags: ["朋友", "跑友"] }],
          places: [{ type: "place", name: "朝阳公园", tags: ["运动", "户外"] }],
          activities: [{ type: "activity", name: "跑步", tags: ["健身"] }], foods: [], attachments: [] },
        { id: "evt-1006-2", time: "14:00", note: "在咖啡馆写了项目方案", remark: "集中精力两个小时，写完了方案主体部分", location: { name: "星巴克国贸店" },
          people: [], places: [{ type: "place", name: "星巴克", tags: ["咖啡馆"] }],
          activities: [{ type: "activity", name: "写方案", tags: ["工作"] }],
          foods: [{ type: "food", name: "拿铁", tags: ["咖啡"] }], attachments: [] },
        { id: "evt-1006-3", time: "20:00", note: "和爸妈视频通话", remark: "妈妈说家里的桂花开了，很香", location: { name: "家" },
          people: [{ type: "person", name: "爸爸", tags: ["家人"] }, { type: "person", name: "妈妈", tags: ["家人"] }],
          places: [{ type: "place", name: "家", tags: ["生活"] }],
          activities: [{ type: "activity", name: "视频通话", tags: [] }], foods: [], attachments: [] },
      ], note: "周末过得很充实，运动、工作、陪伴家人都兼顾到了。"
    },
    learn: { sources: [{ type: "thing", name: "播客《硅谷早知道》", tags: [] }], content: "本期讲了 AI Agent 的最新进展。关键洞察：Agent 的价值不在于替代人，而在于处理那些重复性高、需要耐心但不需要创造力的任务。" },
    input: { kind: "文章", names: [{ type: "thing", name: "《为什么我们需要深度工作》", tags: [] }], excerpt: "在这个注意力稀缺的时代，能够长时间专注于一项复杂任务的能力，已经成为一种稀缺的超能力。" },
    idea: { tags: ["生活"], content: "想在阳台种点香草，比如薄荷和罗勒，这样做调酒和意面的时候可以直接用。" },
    todos: [
      { id: "todo-1006-1", title: "晨跑 5 公里", done: true, time: "07:00", priority: "medium", status: "done" },
      { id: "todo-1006-2", title: "完成项目方案", done: true, time: "14:00", priority: "high", status: "done" },
      { id: "todo-1006-3", title: "给爸妈打电话", done: true, time: "20:00", priority: "medium", status: "done" },
      { id: "todo-1006-4", title: "整理书架", done: false, time: "", priority: "low", status: "todo" },
    ], todosExtra: ""
  },
  {
    date: "2026-10-07", weather: "阴", sleep: "8h", mood: "慵懒",
    facts: {
      events: [
        { id: "evt-1007-1", time: "10:00", note: "在家读完了《深度工作》", remark: "最后一章讲意志力是有限资源，要把深度工作安排在精力最好的时段", location: { name: "家书房" },
          people: [], places: [{ type: "place", name: "家", tags: ["生活"] }],
          activities: [{ type: "activity", name: "读书", tags: [] }], foods: [], attachments: [] },
        { id: "evt-1007-2", time: "13:00", note: "和陈静在家吃了火锅", remark: "陈静带了她自己做的冰粉，太好吃了", location: { name: "家" },
          people: [{ type: "person", name: "陈静", tags: ["朋友", "室友"] }],
          places: [{ type: "place", name: "家", tags: ["生活"] }],
          activities: [{ type: "activity", name: "吃火锅", tags: [] }],
          foods: [{ type: "food", name: "火锅", tags: [] }, { type: "food", name: "冰粉", tags: ["甜品"] }], attachments: [] },
        { id: "evt-1007-3", time: "16:00", note: "在家看了电影《星际穿越》", remark: "第三次看了，每次看都对时间和亲情有新的理解", location: { name: "家客厅" },
          people: [{ type: "person", name: "陈静", tags: ["朋友", "室友"] }],
          places: [{ type: "place", name: "家", tags: ["生活"] }],
          activities: [{ type: "activity", name: "看电影", tags: [] }], foods: [], attachments: [] },
      ], note: "阴雨天适合在家待着，读书、吃火锅、看电影，完美的一天。"
    },
    learn: { sources: [{ type: "thing", name: "《深度工作》", tags: [] }], content: "卡尔·纽波特提出意志力有限理论：意志力不是性格特征，而是有限的生理资源。深度工作需要意志力来抵抗分心，所以应该把它安排在精力最充沛的时段。" },
    input: { kind: "影视", names: [{ type: "thing", name: "《星际穿越》", tags: [] }], excerpt: "爱是唯一能超越时间和空间维度的力量。也许我们应该相信爱，即使我们还不能完全理解它。" },
    idea: { tags: ["读书"], content: "想做一个读书卡片系统，每读完一本书就提取三个核心观点和一个行动项，方便日后回顾。" },
    todos: [
      { id: "todo-1007-1", title: "读完《深度工作》", done: true, time: "", priority: "medium", status: "done" },
      { id: "todo-1007-2", title: "买火锅食材", done: true, time: "", priority: "medium", status: "done" },
    ], todosExtra: ""
  },
  {
    date: "2026-10-08", weather: "小雨", sleep: "7h", mood: "专注",
    facts: {
      events: [
        { id: "evt-1008-1", time: "09:00", note: "在公司参加了代码评审", remark: "评审了新人写的模块，提了几个关于错误处理的建议", location: { name: "公司" },
          people: [{ type: "person", name: "赵磊", tags: ["同事", "新人"] }, { type: "person", name: "李明", tags: ["同事", "产品"] }],
          places: [{ type: "place", name: "公司", tags: ["工作"] }],
          activities: [{ type: "activity", name: "代码评审", tags: ["工作"] }], foods: [], attachments: [] },
        { id: "evt-1008-2", time: "12:30", note: "在公司食堂吃了红烧肉和米饭", remark: "今天食堂的红烧肉特别入味", location: { name: "公司食堂" },
          people: [], places: [{ type: "place", name: "公司", tags: ["工作"] }],
          activities: [{ type: "activity", name: "吃午饭", tags: [] }],
          foods: [{ type: "food", name: "红烧肉", tags: [] }, { type: "food", name: "米饭", tags: ["主食"] }], attachments: [] },
        { id: "evt-1008-3", time: "15:00", note: "和客户在公司演示了产品原型", remark: "客户对 AI 拆分功能很感兴趣，约了下周深入沟通", location: { name: "公司会议室" },
          people: [{ type: "person", name: "孙总", tags: ["客户"] }],
          places: [{ type: "place", name: "公司", tags: ["工作"] }],
          activities: [{ type: "activity", name: "产品演示", tags: ["工作"] }], foods: [], attachments: [] },
      ], note: "今天工作很专注，客户反馈也不错。"
    },
    learn: { sources: [{ type: "thing", name: "技术博客", tags: [] }], content: "学习了 Zod 校验库的进阶用法。discriminated union 可以根据某个字段来选择不同的 schema 分支，非常适合处理多态数据。" },
    input: { kind: "文章", names: [{ type: "thing", name: "《React 19 新特性详解》", tags: [] }], excerpt: "React 19 引入了 use() Hook，可以在组件中直接读取 Promise 和 Context，简化了异步数据获取的写法。" },
    idea: { tags: ["技术", "产品"], content: "代码评审时的常见错误模式可以整理成一个 checklist，新人入职时发给他们，能减少很多低级错误。" },
    todos: [
      { id: "todo-1008-1", title: "代码评审", done: true, time: "09:00", priority: "high", status: "done" },
      { id: "todo-1008-2", title: "产品演示", done: true, time: "15:00", priority: "high", status: "done" },
      { id: "todo-1008-3", title: "写周报", done: false, time: "17:00", priority: "medium", status: "doing" },
      { id: "todo-1008-4", title: "准备下周客户沟通材料", done: false, time: "", priority: "high", status: "todo" },
    ], todosExtra: ""
  },
  {
    date: "2026-10-09", weather: "晴", sleep: "7.5h", mood: "愉快",
    facts: {
      events: [
        { id: "evt-1009-1", time: "08:00", note: "在家做了早餐：煎蛋和吐司", remark: "用了新买的黄油，吐司特别香", location: { name: "家厨房" },
          people: [], places: [{ type: "place", name: "家", tags: ["生活"] }],
          activities: [{ type: "activity", name: "做早餐", tags: [] }],
          foods: [{ type: "food", name: "煎蛋", tags: [] }, { type: "food", name: "吐司", tags: ["主食"] }], attachments: [] },
        { id: "evt-1009-2", time: "10:00", note: "在公司和团队开了周会", remark: "本周进度不错，下周重点是客户沟通和产品优化", location: { name: "公司" },
          people: [{ type: "person", name: "李明", tags: ["同事", "产品"] }, { type: "person", name: "赵磊", tags: ["同事", "新人"] }, { type: "person", name: "王芳", tags: ["同事", "朋友"] }],
          places: [{ type: "place", name: "公司", tags: ["工作"] }],
          activities: [{ type: "activity", name: "周会", tags: ["工作"] }], foods: [], attachments: [] },
        { id: "evt-1009-3", time: "18:30", note: "和张伟在簋街吃了小龙虾", remark: "张伟说他换了新工作，下个月去上海发展", location: { name: "簋街胡大小龙虾" },
          people: [{ type: "person", name: "张伟", tags: ["朋友", "跑友"] }],
          places: [{ type: "place", name: "簋街", tags: ["美食"] }],
          activities: [{ type: "activity", name: "吃晚饭", tags: [] }],
          foods: [{ type: "food", name: "小龙虾", tags: ["美食"] }, { type: "food", name: "啤酒", tags: ["饮品"] }], attachments: [] },
      ], note: "今天既高效又开心，和朋友聚聚感觉很好。"
    },
    learn: { sources: [{ type: "thing", name: "得到课程", tags: [] }], content: "学习了《行为设计学》关于习惯养成的内容。核心观点：不要依赖意志力，要设计环境。让好习惯容易做，让坏习惯不容易做。" },
    input: { kind: "书", names: [{ type: "thing", name: "《原子习惯》", tags: [] }], excerpt: "习惯是自我提升的复利。每天进步 1%，一年后你会进步 37 倍。关键不在于单次的强度，而在于持续的时间。" },
    idea: { tags: ["生活", "习惯"], content: "想把八段锦和晨跑做成习惯链：早上起床后先喝一杯水，然后做八段锦，再出门跑步。用一个简单的启动动作带动后续行为。" },
    todos: [
      { id: "todo-1009-1", title: "周会", done: true, time: "10:00", priority: "high", status: "done" },
      { id: "todo-1009-2", title: "完成周报", done: true, time: "11:00", priority: "medium", status: "done" },
      { id: "todo-1009-3", title: "和张伟吃饭", done: true, time: "18:30", priority: "medium", status: "done" },
      { id: "todo-1009-4", title: "准备客户沟通材料", done: false, time: "", priority: "high", status: "todo" },
      { id: "todo-1009-5", title: "预约下周牙医", done: false, time: "", priority: "low", status: "todo" },
    ], todosExtra: ""
  },
  {
    date: "2026-10-10", weather: "晴", sleep: "6h", mood: "疲惫",
    facts: {
      events: [
        { id: "evt-1010-1", time: "09:30", note: "在公司写了客户沟通方案", remark: "花了一上午，终于把方案打磨满意了", location: { name: "公司" },
          people: [], places: [{ type: "place", name: "公司", tags: ["工作"] }],
          activities: [{ type: "activity", name: "写方案", tags: ["工作"] }], foods: [], attachments: [] },
        { id: "evt-1010-2", time: "14:00", note: "和孙总在咖啡馆继续沟通产品方案", remark: "孙总提出了几个很有价值的反馈，特别是关于数据安全的部分", location: { name: "国贸星巴克" },
          people: [{ type: "person", name: "孙总", tags: ["客户"] }],
          places: [{ type: "place", name: "星巴克", tags: ["咖啡馆"] }],
          activities: [{ type: "activity", name: "客户沟通", tags: ["工作"] }],
          foods: [{ type: "food", name: "美式咖啡", tags: ["咖啡"] }], attachments: [] },
        { id: "evt-1010-3", time: "21:00", note: "在家简单吃了泡面", remark: "太累了不想做饭", location: { name: "家" },
          people: [], places: [{ type: "place", name: "家", tags: ["生活"] }],
          activities: [{ type: "activity", name: "吃晚饭", tags: [] }],
          foods: [{ type: "food", name: "泡面", tags: [] }], attachments: [] },
      ], note: "今天工作强度比较大，晚上有点累，早点休息。"
    },
    learn: { sources: [], content: "" },
    input: { kind: "", names: [], excerpt: "" },
    idea: { tags: [], content: "" },
    todos: [
      { id: "todo-1010-1", title: "完成客户沟通方案", done: true, time: "", priority: "high", status: "done" },
      { id: "todo-1010-2", title: "和孙总沟通", done: true, time: "14:00", priority: "high", status: "done" },
      { id: "todo-1010-3", title: "预约牙医", done: false, time: "", priority: "low", status: "todo" },
    ], todosExtra: ""
  },
  {
    date: "2026-10-11", weather: "晴", sleep: "8h", mood: "不错",
    facts: {
      events: [
        { id: "evt-1011-1", time: "09:00", note: "在家打了五禽戏", remark: "虎戏的威猛感找到了，鹿戏的轻盈还需要练", location: { name: "家客厅" },
          people: [], places: [{ type: "place", name: "家", tags: ["生活"] }],
          activities: [{ type: "activity", name: "打五禽戏", tags: ["健身", "气功"] }], foods: [], attachments: [] },
        { id: "evt-1011-2", time: "11:00", note: "和陈静在家整理了书架", remark: "翻出了大学时的笔记，回忆了很多往事", location: { name: "家" },
          people: [{ type: "person", name: "陈静", tags: ["朋友", "室友"] }],
          places: [{ type: "place", name: "家", tags: ["生活"] }],
          activities: [{ type: "activity", name: "整理书架", tags: [] }], foods: [], attachments: [] },
        { id: "evt-1011-3", time: "13:00", note: "和陈静在家做了意大利面", remark: "用了新鲜罗勒，味道比外面餐厅还好", location: { name: "家厨房" },
          people: [{ type: "person", name: "陈静", tags: ["朋友", "室友"] }],
          places: [{ type: "place", name: "家", tags: ["生活"] }],
          activities: [{ type: "activity", name: "做饭", tags: [] }],
          foods: [{ type: "food", name: "意大利面", tags: [] }, { type: "food", name: "罗勒", tags: ["香草"] }], attachments: [] },
      ], note: "周末在家休息，做了运动、整理了房间、做了好吃的，很满足。"
    },
    learn: { sources: [{ type: "thing", name: "《五禽戏图解》", tags: [] }], content: "五禽戏中鹿戏的关键是舒展。鹿喜舒展，通过伸展四肢和躯干，起到疏肝理气、舒展筋骨的作用。" },
    input: { kind: "书", names: [{ type: "thing", name: "《意大利料理基础》", tags: [] }], excerpt: "好的意大利面酱汁应该能裹住每一根面条，而不是堆积在盘底。关键是让面条和酱汁在锅中充分混合。" },
    idea: { tags: ["生活", "美食"], content: "想在家开辟一个香草角，种罗勒、薄荷、迷迭香，做西餐的时候随手就能摘。" },
    todos: [
      { id: "todo-1011-1", title: "晨练五禽戏", done: true, time: "09:00", priority: "medium", status: "done" },
      { id: "todo-1011-2", title: "整理书架", done: true, time: "", priority: "low", status: "done" },
      { id: "todo-1011-3", title: "预约牙医", done: true, time: "", priority: "low", status: "done" },
      { id: "todo-1011-4", title: "准备下周工作清单", done: false, time: "", priority: "medium", status: "todo" },
    ], todosExtra: ""
  },
];

async function saveDiary(doc) {
  const res = await fetch(`${API}/api/diaries/${doc.date}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-diary-record-version": "2", "If-Match": "0" },
    body: JSON.stringify(doc),
  });
  const data = await res.json();
  if (!res.ok) {
    // 如果版本冲突（日记已存在），用返回的版本重试
    if (res.status === 409 && data.current?.version) {
      const res2 = await fetch(`${API}/api/diaries/${doc.date}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-diary-record-version": "2", "If-Match": data.current.version },
        body: JSON.stringify(doc),
      });
      const data2 = await res2.json();
      if (!res2.ok) console.error(`  失败 [${doc.date}]:`, data2.error);
      else console.log(`  已覆盖 [${doc.date}]`);
      return;
    }
    console.error(`  失败 [${doc.date}]:`, data.error);
    return;
  }
  console.log(`  成功 [${doc.date}]`);
}

console.log(`开始生成 ${diaries.length} 天测试日记...`);
for (const doc of diaries) {
  await saveDiary(doc);
}
console.log("完成！");
