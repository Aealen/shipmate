# 品牌主色换色记录（2026-09-23）

> 用户决策：Wise 原版亮绿不契合，改用**靖蓝 Indigo**。Wise 形态语言（鼠尾草底、白卡 24px 圆角、Noto Sans SC 900/600/400）全部保留。

## token 映射（shipmate.pen 变量已更新）

| token | 原 Wise 绿 | 现 Indigo | 用途 |
|---|---|---|---|
| `wise-primary` | #9fe870 | **#4f46e5** | CTA 主按钮、Tab/侧栏激活指示条、勾选选中态、开关开启态 |
| `wise-primary-active` | #cdffad | **#6366f1** | CTA hover |
| `wise-primary-neutral` | #c5edab | **#e0e7ff** | create/created 类型徽章底（黑字） |
| `wise-primary-pale` | #e2f6d5 | **保持 #e2f6d5** | 成功徽章底（与 positive-deep #054d28 字配对），不随品牌色变 |

## 配套规则

- CTA 按钮一律 **靛蓝底 + 白字**（原绿底黑字；#4f46e5 上黑字对比不足）
- ink 深底（日志区/合并条/智能合并按钮）上的品牌色文字与图标用亮档 **#818cf8**
- 成功语义（done/confirmed/active/已分析）继续用 positive 绿族徽章，与品牌蓝彻底分离——"品牌色不做状态色"红线继续成立
- 警示 #ffd11a 族、危险 #320707 深栗底白字、鼠尾草底与白卡体系均不变

## 第二轮去绿 + 第三轮图表色（2026-09-23，用户反馈"绿色太多太活泼"→"柱状图不要黑色"）

大色块数据可视化统一走靛蓝图表色系（GitHub/Linear 模式），小面积语义绿保留：

- **图表色变量**：`wise-graph-1` #6366f1（主）、`wise-graph-2` #a5b4fc（次）、`wise-graph-3` #c5c7c4（辅助浅灰）
- **进度条/置信度条/趋势柱**（53 处）：→ `wise-graph-1` #6366f1（置信度分档改 蓝/黄/红）
- **P5b 需求点状态分布**：done=graph-1、confirmed=graph-2、developing=#ffd11a、draft=graph-3
- **P6 实体类型分布**：需求点=graph-1、任务=graph-2、素材=graph-3、分组/项目=#868685；**actor 分布**：human=graph-1、ai:analysis=graph-2、mcp=graph-3
- **浅绿信息提示条**（13 处）：primary-pale → canvas-soft 灰底 + body 字（P3d 应用确认、P5c 确认说明、P8b tip、P8c 关于、Note Bar 等）
- **品牌浅靛蓝强调**（#e0e7ff 底 + ink 字）：P7 推荐徽章、P3l AI 建议 pill、P3b 引用高亮块、P6 AI 产出占比强调卡
- **保留的绿**：badge-positive 成功徽章（浅绿底 #e2f6d5 + 深绿字 #054d28）、done/confirmed 状态点、统计行已完成点、"N done" 数字——小面积成功语义

## 落地到 web 代码时

globals.css 的 `--accent` 系映射为品牌靛蓝三档；`--chart-1/2/3` 对应图表三色；`--success` 系沿用 positive 绿族（仅小徽章/状态点）；进度条/图表填充一律用 --chart-1。原型成品图见 `.pen-export/wise-indigo-final/`（35 张）。
