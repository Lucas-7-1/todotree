import { useEffect, useState } from "react";
import { isAndroid } from "../../services/native/platform";
import { formatDateInTimezone } from "../../services/calendarService";
export function useMobileLayout() {
  const [mobile, setMobile] = useState(
    () =>
      isAndroid() ||
      (window.matchMedia?.("(max-width: 767px)").matches ??
        window.innerWidth < 768),
  );
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setMobile(isAndroid() || query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return mobile;
}
export function useToday(timezone: string) {
  const [today, setToday] = useState(() =>
    formatDateInTimezone(new Date(), timezone),
  );
  useEffect(() => {
    const update = () => setToday(formatDateInTimezone(new Date(), timezone));
    update();
    const timer = window.setInterval(update, 15000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [timezone]);
  return today;
}
