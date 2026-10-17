// Дописано нами: в выдаче 21st.dev этого файла не было (chat.tsx его подключает).
// Пока человек крутит переписку колесом или пальцем, автопрокрутка вниз молчит `ms` миллисекунд.
import * as React from "react";

export function useUserInterruption(ms: number) {
  const interruptedRef = React.useRef(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const interrupt = React.useCallback(() => {
    interruptedRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      interruptedRef.current = false;
      timerRef.current = null;
    }, ms);
  }, [ms]);

  React.useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { interruptedRef, interrupt };
}
