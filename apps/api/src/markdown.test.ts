import { describe, expect, it } from "vitest";
import { parseDiaryMarkdown, serializeDiaryMarkdown } from "./markdown.js";

describe("diary markdown", () => {
  it('round-trips Obsidian tasks, time, completion and other notes', () => {
    const parsed = parseDiaryMarkdown('## 待办清单\n- [ ] [09:30] 整理会议笔记\n- [x] 买牛奶\n\n保留手写说明\n', '2026-09-09');
    expect(parsed.todos).toHaveLength(2);
    expect(parsed.todos[0]).toMatchObject({ title: '整理会议笔记', done: false, time: '09:30' });
    expect(parsed.todos[1].done).toBe(true);
    const markdown = serializeDiaryMarkdown(parsed);
    expect(markdown).toContain('- [x] 买牛奶');
    const again = parseDiaryMarkdown(markdown, parsed.date);
    expect(again.todos).toEqual(parsed.todos);
    expect(again.todosExtra).toBe('保留手写说明');
    again.todos[0].done = true;
    expect(serializeDiaryMarkdown(again)).toContain('- [x] [09:30] 整理会议笔记');
  });
  it("reads the existing flat format and keeps unknown content", () => {
    const source = `---
date: 2026-09-07
mood: 平静
custom_field: 保留我
---

# 2026-09-07 每日记录

## 今日事实
- 和谁：小王、阿明
- 去哪：公园
- 做了什么：散步
- 吃了什么：咖啡

## 私人补充
这段由 Obsidian 手工维护。
`;

    const parsed = parseDiaryMarkdown(source, "2026-09-07");
    expect(parsed.mood).toBe("平静");
    expect(parsed.facts.events[0]?.people.map((item) => item.name)).toEqual(["小王", "阿明"]);
    expect(parsed.unknownFrontmatter.custom_field).toBe("保留我");
    expect(parsed.unknownSections[0]?.heading).toBe("私人补充");

    const serialized = serializeDiaryMarkdown(parsed);
    expect(serialized).toContain("custom_field: 保留我");
    expect(serialized).toContain("## 私人补充");
    expect(serialized).toContain("这段由 Obsidian 手工维护。");
  });

  it("round-trips multiple events and Chinese tags", () => {
    const source = `---
date: 2026-09-08
---

# 2026-09-08 每日记录

## 今日事实

### 事件 1
- 时间：19:42
- 描述：和小王在滨江公园散步
- 事件备注：聊得很放松
- 和谁：小王 [朋友]
- 在哪：滨江公园 [户外]
- 做了什么：散步 [运动]
- 吃了什么：

### 事件 2
- 描述：回家煮咖啡
- 和谁：
- 在哪：家 [住所]
- 做了什么：烹饪
- 吃了什么：咖啡 [饮品]
`;

    const parsed = parseDiaryMarkdown(source, "2026-09-08");
    expect(parsed.facts.events).toHaveLength(2);
    expect(parsed.facts.events[0]?.people[0]?.tags).toEqual(["朋友"]);
    expect(parsed.facts.events[0]?.time).toBe("19:42");
    expect(parsed.facts.events[0]?.remark).toBe("聊得很放松");
    expect(parsed.facts.events[1]?.foods[0]?.tags).toEqual(["饮品"]);

    const reparsed = parseDiaryMarkdown(serializeDiaryMarkdown(parsed), "2026-09-08");
    expect(reparsed.facts.events).toHaveLength(2);
    expect(reparsed.facts.events[1]?.note).toBe("回家煮咖啡");
    expect(reparsed.facts.events[1]?.places[0]?.name).toBe("家");
    expect(reparsed.facts.events[0]?.remark).toBe("聊得很放松");
    expect(reparsed.facts.events[0]?.time).toBe("19:42");
  });

  it("keeps an event that contains only its own remark", () => {
    const source = `---\ndate: 2026-09-08\n---\n\n## 今日事实\n\n### 事件 1\n- 事件备注：这件事需要下周继续跟进\n`;
    const parsed = parseDiaryMarkdown(source, "2026-09-08");
    expect(parsed.facts.events).toHaveLength(1);
    expect(parsed.facts.events[0]?.remark).toBe("这件事需要下周继续跟进");
    expect(parseDiaryMarkdown(serializeDiaryMarkdown(parsed), "2026-09-08").facts.events).toHaveLength(1);
  });
});
