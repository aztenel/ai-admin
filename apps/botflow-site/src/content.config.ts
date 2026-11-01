import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";

/**
 * Кейсы. Каждый — файл src/content/cases/<slug>.md, страница /cases/<slug>/.
 * В кейс попадают только запущенные работы и только проверенные факты.
 * Позже рядом появятся коллекции blog и demos с тем же подходом.
 */
const screen = z.object({
  src: z.string(),          // базовое имя в /public/images/<case>/ без ширины и расширения
  widths: z.array(z.number()).min(1),
  ratio: z.string(),        // соотношение сторон исходника «w / h», чтобы не было сдвига вёрстки
  alt: z.string(),
  caption: z.string(),
  phone: z.boolean().default(false),
});

const cases = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/cases" }),
  schema: z.object({
    title: z.string(),
    client: z.string(),
    summary: z.string(),
    description: z.string(),
    url: z.url().optional(),
    year: z.number(),
    status: z.string(),
    order: z.number().default(0),
    services: z.array(z.string()),
    facts: z.array(z.object({ term: z.string(), value: z.string() })),
    screens: z.array(screen),
    /** Подтверждено, что клиент не против публикации. Пока false — так и пишем в README. */
    clientApproved: z.boolean().default(false),
  }),
});

export const collections = { cases };
