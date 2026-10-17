// Общий помощник shadcn/ui: склеивает классы Tailwind и убирает конфликтующие.
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
