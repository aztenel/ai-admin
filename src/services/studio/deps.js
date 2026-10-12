// @ts-check
// «Мои боты»: то, что контроллеру нужно из хранилища. Слой controllers не подключает db напрямую (CLAUDE.md §4), поэтому берёт через services.
export { kvRetry } from "../../db/kv/retry.js";
