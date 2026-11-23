// Tanıtım (demo) dükkânları. Liste koddadır, sahip panelinden değiştirilemez;
// gerçek dükkânlar buraya eklenmez.
//
// Bu dükkânlarda:
// - Personel girişi PIN istemez: personel adına dokununca doğrudan girer.
// - Yönetici girişi yine yönetici PIN'ini ister.
// - İşletme (sahip) sekmesi sahip PIN'i yerine o şubenin yönetici PIN'iyle açılır.
//   Görüntüleme açıktır; sahip PIN'ini değiştirmek ve şube eklemek/silmek kapalıdır.

/** Güzellik demo dükkânlarının kısa adları (/s/<kod>) */
export const DEMO_SHOPS: readonly string[] = ['guzellik-demo']

const isDemoShop = (slug: string | undefined | null) => !!slug && DEMO_SHOPS.includes(slug)

/** Personel girişi PIN'siz mi */
export const staffPinSkipped = isDemoShop

/** İşletme sekmesi yönetici PIN'iyle mi açılır (sahip PIN'ini değiştirmek ve şube eklemek kapalı) */
export const ownerViaManagerPin = isDemoShop
