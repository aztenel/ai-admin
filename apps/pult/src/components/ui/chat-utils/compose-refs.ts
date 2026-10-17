// Дописано нами: в выдаче 21st.dev этого файла не было (chat.tsx его подключает).
// Один ref-обработчик на несколько ref'ов — как useComposedRefs из Radix.
import * as React from "react";

type PossibleRef<T> = React.Ref<T> | undefined;

function setRef<T>(ref: PossibleRef<T>, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as React.RefObject<T | null>).current = value;
}

export function composeRefs<T>(...refs: PossibleRef<T>[]) {
  return (node: T | null) => refs.forEach((ref) => setRef(ref, node));
}

export function useComposedRefs<T>(...refs: PossibleRef<T>[]) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return React.useCallback(composeRefs(...refs), refs);
}
