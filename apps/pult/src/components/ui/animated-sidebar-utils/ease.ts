// Дописано нами: в выдаче 21st.dev этого файла не было (animated-sidebar.tsx его подключает).
// Кривые и пружины анимаций бокового меню.
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

export const SPRING_LAYOUT = {
  type: "spring",
  stiffness: 500,
  damping: 40,
  mass: 0.8,
} as const;

export const SPRING_PRESS = {
  type: "spring",
  stiffness: 600,
  damping: 30,
} as const;
