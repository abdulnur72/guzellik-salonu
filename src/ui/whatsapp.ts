/** Türkiye numarasını wa.me linkine çevirir (05xx… -> 905xx…). */
export function waLink(phone: string | undefined, text: string) {
  let d = String(phone || '').replace(/\D/g, '')
  if (d.startsWith('0')) d = '90' + d.slice(1)
  else if (d.length === 10) d = '90' + d
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`
}

export function isValidTrPhone(phone: string) {
  const d = phone.replace(/\D/g, '')
  return /^(0?5\d{9}|905\d{9})$/.test(d)
}

/** Salon numarası wa.me linki kurmaya yetecek kadar tam mı (alan kodu dahil en az 10 hane) */
export function canWhatsApp(phone: string | undefined) {
  return String(phone || '').replace(/\D/g, '').replace(/^0+/, '').length >= 10
}
