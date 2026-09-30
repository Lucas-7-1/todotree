import React from 'react';
import './app-mode.css';
export type AppMode = 'tasks' | 'journal' | 'health';
export const readMode = (): AppMode => { try { const mode = localStorage.getItem('todotree.app-mode.v1'); return mode === 'journal' || mode === 'health' ? mode : 'tasks'; } catch { return 'tasks'; } };
export function rememberMode(mode: AppMode) { try { localStorage.setItem('todotree.app-mode.v1',mode); } catch { /* Preferences do not replace durable data. */ } }
export function requestMode(mode: AppMode) { window.dispatchEvent(new CustomEvent('todotree:mode', {detail: {mode}})); }
export function AppModeSwitch({mode,onChange,disabled=false}:{mode:AppMode;onChange:(mode:AppMode)=>void;disabled?:boolean}) {
  return <nav className="app-mode-switch" aria-label="应用模式"><div>
    {(['tasks','journal','health'] as AppMode[]).map(value => <button key={value} aria-pressed={mode===value} disabled={disabled} onClick={()=>mode!==value&&onChange(value)}>{value==='tasks'?'待办':value==='journal'?'手帐':'健康'}</button>)}
  </div></nav>;
}
