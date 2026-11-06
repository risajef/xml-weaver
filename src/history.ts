import type { ElementNode } from "./editor-core";

export interface TreeSnapshot { root: ElementNode; selectedId: string | null; }
export interface History { past: TreeSnapshot[]; future: TreeSnapshot[]; }
export function createHistory(): History { return {past: [], future: []}; }
export function recordEdit(history: History, snapshot: TreeSnapshot): void {
  history.past.push(snapshot);
  history.future = [];
  while (history.past.length > 30 || (history.past.length > 1 && JSON.stringify(history.past).length > 4 * 1024 * 1024)) history.past.shift();
}
export function traverseHistory(history: History, current: TreeSnapshot, redo = false): TreeSnapshot | null {
  const source = redo ? history.future : history.past;
  const target = redo ? history.past : history.future;
  const next = source.pop();
  if (!next) return null;
  target.push(current);
  return next;
}
