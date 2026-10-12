// @ts-check
// Права доступа к данным клиента: кто какого клиента видит.
// доступ к данным клиента cid: владелец — к любому, сотрудник — к своему
/** @param {any} s @param {string} cid @returns {boolean} */
export const canSee = (s, cid) => !!s && (s.role === "owner" || (s.role === "staff" && s.cid === cid));
