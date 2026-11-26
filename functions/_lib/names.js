export const SECRET_FIELDS = [
  ["EDOOKIT_ACCESS_CODE_1", "Edookit, první kód"],
  ["EDOOKIT_ACCESS_CODE_2", "Edookit, druhý kód"],
  ["EDOOKIT_BASE_URL", "Adresa Edookitu"],
  ["EJIDELNICEK_EMAIL", "E-mail do jídelny"],
  ["EJIDELNICEK_PASSWORD", "Heslo do jídelny"],
  ["ACCESS_UUID", "Přístupový kód této stránky"],
  ["ALLOWED_IPS", "Povolené IP adresy"],
];

export const SECRET_NAMES = SECRET_FIELDS.map(([name]) => name);

export const CF_ACCOUNT = "08036738b61d2eac6a5bb21018ad89cc";
export const CF_PROJECT = "skolni-obedy";
export const RUNTIME_URL = "https://skolni-obedy-runtime.63ecz.workers.dev";
