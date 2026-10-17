// Дописано нами: в выдаче 21st.dev этого файла не было (animated-sidebar.tsx его подключает).
// Подсветка под пунктом меню, на который наведена мышь: одна плашка переезжает от пункта к пункту.
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { cn } from "@/lib/utils";

type SharedLayoutBgProps = React.HTMLAttributes<HTMLElement> & {
  as?: "ul" | "ol" | "div" | "nav";
  /** Отступ плашки от краёв пункта, px. */
  inset?: number;
  pillClassName?: string;
  pillContainerClassName?: string;
  "data-slot"?: string;
};

export const SharedLayoutBg = React.forwardRef<HTMLElement, SharedLayoutBgProps>(
  function SharedLayoutBg(
    {
      as: Tag = "div",
      inset = 0,
      pillClassName,
      pillContainerClassName,
      className,
      children,
      onPointerOver,
      onPointerLeave,
      ...props
    },
    forwardedRef,
  ) {
    const reduce = useReducedMotion() ?? false;
    const [top, setTop] = React.useState<number | null>(null);

    const handlePointerOver = (event: React.PointerEvent<HTMLElement>) => {
      onPointerOver?.(event);
      const container = event.currentTarget;
      let item = event.target as HTMLElement | null;
      while (item && item.parentElement !== container) item = item.parentElement;
      // пункт без кнопки (или кнопка выключена) — плашку не показываем
      if (!item || item.querySelector("button:disabled, [aria-disabled='true']")) return setTop(null);
      setTop(item.offsetTop);
    };

    return React.createElement(
      Tag,
      {
        ...props,
        ref: forwardedRef,
        className: cn("relative", className),
        onPointerOver: handlePointerOver,
        onPointerLeave: (event: React.PointerEvent<HTMLElement>) => {
          onPointerLeave?.(event);
          setTop(null);
        },
      },
      <div aria-hidden="true" className={cn("pointer-events-none absolute inset-0", pillContainerClassName)}>
        <motion.div
          initial={false}
          animate={{ opacity: top === null ? 0 : 1, y: top ?? 0 }}
          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
          style={{ position: "absolute", inset }}
          className={pillClassName}
        />
      </div>,
      children,
    );
  },
);
