// Génération de miniature PDF (page 1) + comptage de pages — utilisé par
// app/api/resources/upload/route.ts ET app/api/messages/upload-file/route.ts.
// Nécessite runtime = 'nodejs' côté route appelante (pdf-to-img → pdfjs-dist,
// incompatible avec Edge).

export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export async function generatePdfThumbnail(
  bytes: ArrayBuffer
): Promise<{ thumbnail: Uint8Array; pageCount: number } | null> {
  try {
    const { pdf } = await import('pdf-to-img');
    const doc = await pdf(new Uint8Array(bytes), { scale: 1.5 });
    const pageCount = doc.length;
    // On n'a besoin que de la première page
    const firstPage = await doc.getPage(1);
    return { thumbnail: firstPage, pageCount };
  } catch (err) {
    console.error('[pdfThumbnail] génération échouée:', err);
    return null;
  }
}
