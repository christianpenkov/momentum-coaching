function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image invalide')); };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', quality));
}

// Route API (Vercel Serverless Node.js) plafonne les requêtes à 4.5 Mo — voir
// app/api/messages/upload-file/route.ts. Les photos iPhone/Android récentes (HEIC/JPEG
// haute résolution) dépassent souvent cette taille. On compresse côté téléphone AVANT
// l'upload plutôt que de bloquer silencieusement l'envoi (bug historique : sendFile()
// retournait sans aucun feedback si file.size > limite).
const TARGET_MAX_BYTES = 4 * 1024 * 1024;
const MAX_DIMENSION = 2400;

// Redimensionne si nécessaire puis réduit la qualité JPEG par paliers jusqu'à passer
// sous TARGET_MAX_BYTES. Retourne le fichier original tel quel s'il est déjà assez petit
// (évite une recompression inutile qui dégraderait une image déjà légère).
export async function compressImageIfNeeded(file: File): Promise<File> {
  if (file.size <= TARGET_MAX_BYTES) return file;

  const img = await loadImage(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  let quality = 0.85;
  let blob = await canvasToBlob(canvas, quality);
  while (blob && blob.size > TARGET_MAX_BYTES && quality > 0.4) {
    quality -= 0.15;
    blob = await canvasToBlob(canvas, quality);
  }

  if (!blob) return file;
  const name = file.name.replace(/\.\w+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg' });
}
