import { TaskNode, DeltaUndoCommand, TaskFieldChanges } from '../types/todo';

const MAX_UNDO_STACK = 50;

class UndoManager {
  private undoStack: DeltaUndoCommand[] = [];
  private redoStack: DeltaUndoCommand[] = [];

  /**
   * Push a delta-based undo command (PRD v1.1 Section 5)
   */
  public pushDelta(
    arg1:
      | string
      | {
          type?: string;
          description: string;
          changes?: Array<{ taskId: string; fieldChanges?: any; before?: any; after?: any }>;
          createdTasks?: TaskNode[];
          deletedTasks?: TaskNode[];
          batchId?: string;
        },
    arg2?: string,
    arg3?: TaskFieldChanges[],
    arg4?: string
  ): string {
    const commandId = 'cmd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    let description = '';
    let type = 'update';
    let changes: TaskFieldChanges[] = [];
    let batchId: string | undefined;

    if (typeof arg1 === 'object') {
      description = arg1.description || '任务操作';
      type = arg1.type || 'update';
      batchId = arg1.batchId;

      if (arg1.createdTasks && arg1.createdTasks.length > 0) {
        for (const ct of arg1.createdTasks) {
          changes.push({
            taskId: ct.id,
            before: { deleted_at: new Date().toISOString() },
            after: { ...ct, deleted_at: null },
          });
        }
      }

      if (arg1.deletedTasks && arg1.deletedTasks.length > 0) {
        for (const dt of arg1.deletedTasks) {
          changes.push({
            taskId: dt.id,
            before: { deleted_at: dt.deleted_at, deletion_batch_id: dt.deletion_batch_id },
            after: { deleted_at: new Date().toISOString() },
          });
        }
      }

      if (arg1.changes) {
        for (const c of arg1.changes as any[]) {
          if (c.fieldChanges) {
            const b: any = {};
            const a: any = {};
            for (const [k, v] of Object.entries(c.fieldChanges as Record<string, { before: any; after: any }>)) {
              b[k] = v.before;
              a[k] = v.after;
            }
            changes.push({
              taskId: c.taskId,
              before: b,
              after: a,
            });
          } else if (c.before && c.after) {
            changes.push({
              taskId: c.taskId,
              before: c.before,
              after: c.after,
            });
          }
        }
      }
    } else {
      description = arg1;
      type = arg2 || 'update';
      changes = arg3 || [];
      batchId = arg4;
    }

    const cmd: DeltaUndoCommand = {
      commandId,
      type,
      description,
      timestamp: Date.now(),
      changes,
      batchId,
      undone: false,
    };

    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX_UNDO_STACK) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    return commandId;
  }

  /**
   * Helper to push simple status toggle (e.g., complete / uncomplete)
   */
  public pushStatusChange(
    arg1:
      | string
      | Array<{
          taskId: string;
          from: TaskNode['status'];
          to: TaskNode['status'];
          completed_at?: string | null;
        }>,
    arg2?:
      | string
      | Array<{ task: TaskNode; prevStatus: TaskNode['status']; prevCompletedAt: string | null }>
  ): string {
    let description = '状态变更';
    const changes: TaskFieldChanges[] = [];

    if (Array.isArray(arg1)) {
      description = typeof arg2 === 'string' ? arg2 : '状态变更';
      for (const item of arg1) {
        changes.push({
          taskId: item.taskId,
          before: {
            status: item.from,
            completed_at: item.from === 'done' ? item.completed_at || new Date().toISOString() : null,
          },
          after: {
            status: item.to,
            completed_at: item.to === 'done' ? item.completed_at || new Date().toISOString() : null,
          },
        });
      }
    } else if (typeof arg1 === 'string' && Array.isArray(arg2)) {
      description = arg1;
      for (const { task, prevStatus, prevCompletedAt } of arg2) {
        changes.push({
          taskId: task.id,
          before: {
            status: prevStatus,
            completed_at: prevCompletedAt,
          },
          after: {
            status: task.status,
            completed_at: task.completed_at,
          },
        });
      }
    }

    return this.pushDelta(description, 'status_change', changes);
  }

  /**
   * Helper to compute diff between old tasks and new tasks, or two task states
   */
  public pushTaskDiff(
    arg1: string | TaskNode,
    arg2: TaskNode[] | TaskNode,
    arg3?: TaskNode[] | string
  ): string | null {
    if (typeof arg1 === 'object' && typeof arg2 === 'object' && !Array.isArray(arg1) && !Array.isArray(arg2)) {
      // Single task diff: pushTaskDiff(beforeTask, afterTask, description)
      const prevT = arg1 as TaskNode;
      const nextT = arg2 as TaskNode;
      const description = typeof arg3 === 'string' ? arg3 : '修改任务';

      const diffBefore: Partial<TaskNode> = {};
      const diffAfter: Partial<TaskNode> = {};
      let hasDiff = false;

      const keysToCheck: Array<keyof TaskNode> = [
        'title',
        'note',
        'status',
        'completed_at',
        'archived_at',
        'quadrant',
        'due_type',
        'due_date',
        'due_at',
        'parent_id',
        'sort_order',
        'deleted_at',
        'outcome_note',
      ];

      for (const k of keysToCheck) {
        if (prevT[k] !== nextT[k]) {
          diffBefore[k] = prevT[k] as any;
          diffAfter[k] = nextT[k] as any;
          hasDiff = true;
        }
      }

      if (!hasDiff) return null;
      return this.pushDelta(description, 'task_diff', [
        {
          taskId: prevT.id,
          before: diffBefore,
          after: diffAfter,
        },
      ]);
    }

    // Full task list diff: pushTaskDiff(description, prevTasks, nextTasks)
    const description = typeof arg1 === 'string' ? arg1 : '更新任务列表';
    const prevTasks = Array.isArray(arg2) ? arg2 : [];
    const nextTasks = Array.isArray(arg3) ? arg3 : [];

    const changes: TaskFieldChanges[] = [];
    const prevMap = new Map(prevTasks.map((t) => [t.id, t]));
    const nextMap = new Map(nextTasks.map((t) => [t.id, t]));

    for (const [id, nextT] of nextMap.entries()) {
      const prevT = prevMap.get(id);
      if (!prevT) {
        changes.push({
          taskId: id,
          before: { deleted_at: new Date().toISOString() },
          after: { ...nextT },
        });
      } else {
        const diffBefore: Partial<TaskNode> = {};
        const diffAfter: Partial<TaskNode> = {};
        let hasDiff = false;

        const keysToCheck: Array<keyof TaskNode> = [
          'title',
          'note',
          'status',
          'completed_at',
          'archived_at',
          'quadrant',
          'due_type',
          'due_date',
          'due_at',
          'parent_id',
          'sort_order',
          'deleted_at',
          'outcome_note',
        ];

        for (const k of keysToCheck) {
          if (prevT[k] !== nextT[k]) {
            diffBefore[k] = prevT[k] as any;
            diffAfter[k] = nextT[k] as any;
            hasDiff = true;
          }
        }

        if (hasDiff) {
          changes.push({
            taskId: id,
            before: diffBefore,
            after: diffAfter,
          });
        }
      }
    }

    if (changes.length === 0) return null;
    return this.pushDelta(description, 'task_diff', changes);
  }

  /**
   * Backward-compatibility: push step snapshot
   */
  public pushStep(description: string, prevTasks: TaskNode[]): string | null {
    const changes: TaskFieldChanges[] = prevTasks.map((t) => ({
      taskId: t.id,
      before: { ...t },
      after: {},
    }));
    return this.pushDelta(description, 'snapshot', changes);
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public getUpcomingUndoDescription(): string | null {
    if (this.undoStack.length === 0) return null;
    return this.undoStack[this.undoStack.length - 1].description;
  }

  public getUpcomingRedoDescription(): string | null {
    if (this.redoStack.length === 0) return null;
    return this.redoStack[this.redoStack.length - 1].description;
  }

  /**
   * Undo the top command, or a specific command by ID (from Toast "撤销" button)
   */
  public undo(
    currentTasks: TaskNode[],
    targetCommandId?: string
  ): { newTasks: TaskNode[]; description: string; commandId: string } | null {
    if (this.undoStack.length === 0) return null;

    let targetIdx = this.undoStack.length - 1;
    if (targetCommandId) {
      const foundIdx = this.undoStack.findIndex((c) => c.commandId === targetCommandId && !c.undone);
      if (foundIdx !== -1) {
        targetIdx = foundIdx;
      }
    }

    const [cmd] = this.undoStack.splice(targetIdx, 1);
    if (!cmd) return null;

    // Apply "before" delta changes without clobbering other unaffected fields (PRD 5.3)
    const changeMap = new Map(cmd.changes.map((c) => [c.taskId, c.before]));
    const newTasks = currentTasks.map((t) => {
      const deltaBefore = changeMap.get(t.id);
      if (deltaBefore) {
        return { ...t, ...deltaBefore, updated_at: new Date().toISOString() };
      }
      return t;
    });

    // Push to redoStack
    this.redoStack.push(cmd);

    return {
      newTasks,
      description: cmd.description,
      commandId: cmd.commandId,
    };
  }

  /**
   * Redo the top command
   */
  public redo(
    currentTasks: TaskNode[]
  ): { newTasks: TaskNode[]; description: string; commandId: string } | null {
    if (this.redoStack.length === 0) return null;

    const cmd = this.redoStack.pop()!;
    const changeMap = new Map(cmd.changes.map((c) => [c.taskId, c.after]));
    const newTasks = currentTasks.map((t) => {
      const deltaAfter = changeMap.get(t.id);
      if (deltaAfter) {
        return { ...t, ...deltaAfter, updated_at: new Date().toISOString() };
      }
      return t;
    });

    this.undoStack.push(cmd);

    return {
      newTasks,
      description: cmd.description,
      commandId: cmd.commandId,
    };
  }

  public clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}

export const undoManager = new UndoManager();
