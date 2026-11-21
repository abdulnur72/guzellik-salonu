/**
 * Seçilen fotoğrafı en fazla 200 piksele küçültüp JPEG olarak döndürür.
 * Kayıtla birlikte (personel ya da şube satırında) saklanır.
 */
export function resizeImage(file: File, max = 200): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(r.error)
    r.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('image'))
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height))
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * k)
        c.height = Math.round(img.height * k)
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        resolve(c.toDataURL('image/jpeg', 0.75))
      }
      img.src = String(r.result)
    }
    r.readAsDataURL(file)
  })
}
