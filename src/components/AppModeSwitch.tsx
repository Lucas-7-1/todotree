import React from 'react';
import './app-mode.css';
export const readMode = () => { try { return localStorage.getItem('todotree.app-mode.v1') === 'journal' ? 'journal' : 'tasks'; } catch { return 'tasks'; } };
export function rememberMode(mode: 'tasks' | 'journal') { try { localStorage.setItem('todotree.app-mode.v1',mode); } catch { /* Preferences do not replace durable data. */ } }
export function AppModeSwitch({mode,onChange,disabled=false}:{mode:'tasks'|'journal';onChange:()=>void;disabled?:boolean}) {
  return <nav className="app-mode-switch" aria-label="应用模式"><div>
    <button aria-pressed={mode==='tasks'} disabled={disabled} onClick={()=>mode!=='tasks'&&onChange()}>待办</button>
    <button aria-pressed={mode==='journal'} disabled={disabled} onClick={()=>mode!=='journal'&&onChange()}>手帐</button>
  </div></nav>;
}
