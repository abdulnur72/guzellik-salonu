// Tanıtım (demo) dükkânları. Bu dükkânlarda Personel girişi PIN istemez:
// personel adına dokununca doğrudan girer. Yönetici ve sahip girişi yine PIN ister.
// Liste koddadır, sahip panelinden değiştirilemez; gerçek dükkânlar buraya eklenmez.

/** Personel girişi PIN'siz olan güzellik demo dükkânlarının kısa adları (/s/<kod>) */
export const DEMO_NO_STAFF_PIN: readonly string[] = ['guzellik-demo']

export const staffPinSkipped = (slug: string | undefined | null) => !!slug && DEMO_NO_STAFF_PIN.includes(slug)
