import { App } from '@capacitor/app';
import { Keyboard } from '@capacitor/keyboard';
import { isAndroid } from './platform';
export function setupNativeLifecycle() {
  if (!isAndroid()) return;
  document.documentElement.classList.add('native-android');
  void Keyboard.addListener('keyboardDidShow', () => document.documentElement.classList.add('keyboard-open'));
  void Keyboard.addListener('keyboardDidHide', () => document.documentElement.classList.remove('keyboard-open'));
  void App.addListener('backButton', async () => {
    if (document.documentElement.classList.contains('keyboard-open')) { await Keyboard.hide(); return; }
    const event = new Event('todotree:back', { cancelable: true });
    if (!window.dispatchEvent(event)) return;
    window.dispatchEvent(new Event('todotree:navigate-back'));
  });
}
