// 生成带分类和时间的测试待办
const API = "http://127.0.0.1:4319";

const today = "2026-10-11";

// 待办数据：分布在不同日期，带分类、截止时间、优先级、状态
const todos = [
  // 工作类
  { date: "2026-10-09", title: "完成 Q4 产品规划方案", category: "work", priority: "high", status: "done", done: true, dueDate: "2026-10-09", dueTime: "18:00", startDate: "2026-10-09", startTime: "09:00" },
  { date: "2026-10-09", title: "代码评审 - 新人模块", category: "work", priority: "medium", status: "done", done: true, dueDate: "2026-10-08", dueTime: "17:00", startDate: "2026-10-08", startTime: "10:00" },
  { date: "2026-10-10", title: "客户沟通材料准备", category: "work", priority: "high", status: "done", done: true, dueDate: "2026-10-10", dueTime: "12:00", startDate: "2026-10-10", startTime: "09:00" },
  { date: "2026-10-11", title: "准备下周客户演示", category: "work", priority: "high", status: "doing", done: false, dueDate: "2026-10-13", dueTime: "10:00", startDate: "2026-10-11", startTime: "14:00" },
  { date: "2026-10-11", title: "回复合作方邮件", category: "work", priority: "medium", status: "todo", done: false, dueDate: "2026-10-11", dueTime: "17:00", startDate: "2026-10-11", startTime: "15:00" },
  { date: "2026-10-11", title: "整理本周周报", category: "work", priority: "medium", status: "todo", done: false, dueDate: "2026-10-12", dueTime: "12:00", startDate: "2026-10-12", startTime: "09:00" },
  { date: "2026-10-06", title: "晨跑 5 公里", category: "personal", priority: "medium", status: "done", done: true, dueDate: "2026-10-06", dueTime: "08:00", startDate: "2026-10-06", startTime: "07:00" },
  { date: "2026-10-07", title: "读完《深度工作》", category: "personal", priority: "low", status: "done", done: true, dueDate: "2026-10-07", dueTime: "22:00", startDate: "2026-10-07", startTime: "10:00" },
  { date: "2026-10-07", title: "买火锅食材", category: "personal", priority: "medium", status: "done", done: true, dueDate: "2026-10-07", dueTime: "12:00", startDate: "2026-10-07", startTime: "11:00" },
  { date: "2026-10-11", title: "预约牙医", category: "personal", priority: "low", status: "done", done: true, dueDate: "2026-10-11", dueTime: "16:00", startDate: "2026-10-11", startTime: "14:00" },
  { date: "2026-10-11", title: "阳台种香草", category: "personal", priority: "low", status: "todo", done: false, dueDate: "2026-10-18", dueTime: "18:00", startDate: "2026-10-12", startTime: "10:00" },
  { date: "2026-10-10", title: "和孙总沟通产品方案", category: "work", priority: "high", status: "done", done: true, dueDate: "2026-10-10", dueTime: "15:00", startDate: "2026-10-10", startTime: "14:00" },
  { date: "2026-10-08", title: "产品原型演示", category: "work", priority: "high", status: "done", done: true, dueDate: "2026-10-08", dueTime: "15:00", startDate: "2026-10-08", startTime: "14:00" },
  { date: "2026-10-11", title: "做意大利面", category: "personal", priority: "low", status: "done", done: true, dueDate: "2026-10-11", dueTime: "13:00", startDate: "2026-10-11", startTime: "12:00" },
  { date: "2026-10-11", title: "打五禽戏", category: "personal", priority: "medium", status: "done", done: true, dueDate: "2026-10-11", dueTime: "10:00", startDate: "2026-10-11", startTime: "09:00" },
  { date: "2026-10-11", title: "整理书架", category: "personal", priority: "low", status: "done", done: true, dueDate: "2026-10-11", dueTime: "12:00", startDate: "2026-10-11", startTime: "11:00" },
  { date: "2026-10-05", title: "回复客户邮件", category: "work", priority: "medium", status: "done", done: true, dueDate: "2026-10-05", dueTime: "16:00", startDate: "2026-10-05", startTime: "15:00" },
  { date: "2026-10-05", title: "完成 Q4 规划初稿", category: "work", priority: "high", status: "done", done: true, dueDate: "2026-10-05", dueTime: "12:00", startDate: "2026-10-05", startTime: "10:00" },
  { date: "2026-10-11", title: "准备下周工作清单", category: "work", priority: "medium", status: "todo", done: false, dueDate: "2026-10-12", dueTime: "09:00", startDate: "2026-10-11", startTime: "20:00" },
  { date: "2026-10-11", title: "买牛奶", category: "personal", priority: "low", status: "todo", done: false, dueDate: "2026-10-11", dueTime: "20:00", startDate: "2026-10-11", startTime: "19:00" },
];

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function loadDiary(date) {
  const res = await fetch(`${API}/api/diaries/${date}`);
  return res.json();
}

async function createTodo(date, todo) {
  const diary = await loadDiary(date);
  const version = diary.version;
  const operationId = uuid();
  const task = {
    id: uuid(),
    title: todo.title,
    done: todo.done || false,
    time: todo.startTime || '',
    plannedDate: date,
    priority: todo.priority || 'medium',
    status: todo.status || 'todo',
    category: todo.category || '',
    important: todo.priority === 'high',
    urgent: todo.dueDate && todo.dueDate <= today,
    startDate: todo.startDate || date,
    startTime: todo.startTime || '',
    dueDate: todo.dueDate || '',
    dueTime: todo.dueTime || '',
    description: '',
    subtasks: [],
    tags: [],
    attachments: [],
  };
  const res = await fetch(`${API}/api/actions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'create', date, version, task, operationId }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error(`  失败 [${date}] ${todo.title}:`, data.error);
    return false;
  }
  console.log(`  成功 [${date}] ${todo.title} (${todo.category})`);
  return true;
}

console.log(`开始生成 ${todos.length} 条测试待办...`);
let ok = 0;
for (const todo of todos) {
  if (await createTodo(todo.date, todo)) ok++;
}
console.log(`完成！成功 ${ok}/${todos.length} 条`);
