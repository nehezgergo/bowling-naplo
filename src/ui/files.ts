/**
 * Fájl mentése. Telefonon a megosztás menüt nyitja (Fájlok, Drive, e-mail),
 * máshol letölti. Igazzal tér vissza, ha a mentés elindult.
 */
export async function saveFile(name: string, content: string, mime: string): Promise<boolean> {
  const file = new File([content], name, { type: mime });
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return true;
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') return false;
      /* ha a megosztás nem megy, letöltés */
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}
