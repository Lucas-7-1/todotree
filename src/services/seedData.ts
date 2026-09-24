import { TaskNode } from '../types/todo';

export function getTodayDateString(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getInitialSeedTasks(): TaskNode[] {
  const now = new Date().toISOString();
  const yesterday = getTodayDateString(-1);
  const today = getTodayDateString(0);
  const tomorrow = getTodayDateString(1);
  const in3Days = getTodayDateString(3); // or upcoming Friday

  return [
    // 1. 工作
    {
      id: 'task-root-work',
      parent_id: null,
      root_bucket: 'categories',
      title: '工作',
      note: '日常工作与重要项目跟进',
      sort_order: 10,
      status: 'open',
      completed_at: null,
      due_type: 'none',
      due_date: null,
      due_at: null,
      quadrant: null,
      planned_date: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      deletion_batch_id: null,
    },
    // 1.1 采购调研
    {
      id: 'task-procurement',
      parent_id: 'task-root-work',
      root_bucket: null,
      title: '采购调研',
      note: '供应商选型评估与报价比对',
      sort_order: 10,
      status: 'open',
      completed_at: null,
      due_type: 'none',
      due_date: null,
      due_at: null,
      quadrant: null,
      planned_date: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      deletion_batch_id: null,
    },
    // 1.1.1 整理供应商清单 (已完成, 昨天)
    {
      id: 'task-vendor-list',
      parent_id: 'task-procurement',
      root_bucket: null,
      title: '整理供应商清单',
      note: '完成头部 5 家重点供应商初筛',
      sort_order: 10,
      status: 'done',
      completed_at: now,
      due_type: 'date',
      due_date: yesterday,
      due_at: null,
      quadrant: null,
      planned_date: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      deletion_batch_id: null,
    },
    // 1.1.2 核对报价 (明天)
    {
      id: 'task-quote-check',
      parent_id: 'task-procurement',
      root_bucket: null,
      title: '核对报价',
      note: '核对硬件与技术授权报价单',
      sort_order: 20,
      status: 'open',
      completed_at: null,
      due_type: 'date',
      due_date: tomorrow,
      due_at: null,
      quadrant: null,
      planned_date: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      deletion_batch_id: null,
    },
    // 1.1.3 完成调研报告 (今天, Q1 重要且紧急)
    {
      id: 'task-survey-report',
      parent_id: 'task-procurement',
      root_bucket: null,
      title: '完成调研报告',
      note: '撰写决策分析与选型建议 PPT',
      sort_order: 30,
      status: 'open',
      completed_at: null,
      due_type: 'date',
      due_date: today,
      due_at: null,
      quadrant: 'Q1',
      planned_date: today,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      deletion_batch_id: null,
    },
    // 1.2 确认会议 (明天, Q3 紧急不重要)
    {
      id: 'task-confirm-meeting',
      parent_id: 'task-root-work',
      root_bucket: null,
      title: '确认会议',
      note: '协调周四下午评审会议室与参会人',
      sort_order: 20,
      status: 'open',
      completed_at: null,
      due_type: 'date',
      due_date: tomorrow,
      due_at: null,
      quadrant: 'Q3',
      planned_date: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      deletion_batch_id: null,
    },

    // 2. 学习
    {
      id: 'task-root-study',
      parent_id: null,
      root_bucket: 'categories',
      title: '学习',
      note: '技能提升与持续精进',
      sort_order: 20,
      status: 'open',
      completed_at: null,
      due_type: 'none',
      due_date: null,
      due_at: null,
      quadrant: null,
      planned_date: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      deletion_batch_id: null,
    },
    // 2.1 学习英语 (周五 / 3天后, Q2 重要不紧急)
    {
      id: 'task-english',
      parent_id: 'task-root-study',
      root_bucket: null,
      title: '学习英语',
      note: '商务沟通与专业词汇积累',
      sort_order: 10,
      status: 'open',
      completed_at: null,
      due_type: 'date',
      due_date: in3Days,
      due_at: null,
      quadrant: 'Q2',
      planned_date: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      deletion_batch_id: null,
    },

    // 3. 生活
    {
      id: 'task-root-life',
      parent_id: null,
      root_bucket: 'categories',
      title: '生活',
      note: '个人生活与健康事务',
      sort_order: 30,
      status: 'open',
      completed_at: null,
      due_type: 'none',
      due_date: null,
      due_at: null,
      quadrant: null,
      planned_date: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      deletion_batch_id: null,
    },
    // 3.1 整理收藏夹 (无日期, Q4 不重要不紧急)
    {
      id: 'task-organize-bookmarks',
      parent_id: 'task-root-life',
      root_bucket: null,
      title: '整理收藏夹',
      note: '清理浏览器与阅读应用中积攒的无用链接',
      sort_order: 10,
      status: 'open',
      completed_at: null,
      due_type: 'none',
      due_date: null,
      due_at: null,
      quadrant: 'Q4',
      planned_date: null,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      deletion_batch_id: null,
    }
  ];
}
