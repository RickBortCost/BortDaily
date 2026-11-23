// Copia nel sito il carattere Inter (niente CDN di terze parti).
// Uso: npm run vendor  (da rieseguire quando si aggiorna @fontsource-variable/inter in package.json)
import { copyFile } from "node:fs/promises";

for (const f of ["inter-latin-wght-normal.woff2", "inter-latin-ext-wght-normal.woff2"]) {
  await copyFile(`node_modules/@fontsource-variable/inter/files/${f}`, `site/fonts/${f}`);
}
console.log("Carattere Inter copiato in site/fonts/");
